// routes/common/userRoutes.js
const express = require("express");
const router = express.Router();

const {
  registerWebUser,
  loginWebUser,
  registerMobileUser,
  loginMobileUser,
  getUsers,
  getMe,
  updateUserDID,
  logoutWebUser,
} = require("../../controllers/common/userController");

const { requestOtp, verifyOtp } = require("../../controllers/mobile/otpController");

const { protect, allowRoles } = require("../../middleware/authMiddleware");
const { rateLimitRedis } = require("../../middleware/rateLimitRedis");
const { z, validate } = require("../../middleware/validate");
const requestLogger = require("../../middleware/requestLogger");
const requireOtpSession = require("../../middleware/requireOtpSession");

// ---------- Schemas ----------
const webLoginSchema = {
  body: z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(200),
  }).strip(),
};

const createWebUserSchema = {
  body: z.object({
    username: z.string().trim().min(2).max(100),
    fullName: z.string().trim().min(2).max(200).optional().nullable(),
    age: z.number().int().min(0).max(150).optional().nullable(),
    address: z.string().trim().max(1000).optional().nullable(),
    gender: z.enum(["male", "female", "other"]).optional().nullable(),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(200),
    contactNo: z.string().trim().max(50).optional().nullable(),
    role: z.enum(["admin", "superadmin", "developer"]).default("admin"),
    // Allow URL or data URI (but prefer imageId flow)
    profilePicture: z.string().url().optional().or(z.string().startsWith("data:image/")).optional().nullable(),
  }).strip(),
};

// ---------- Subrouters to keep concerns separate ----------
const web = express.Router();
const mobile = express.Router();

// Give web routes bigger body limit (profilePicture data-uri if used)
web.use(express.json({ limit: "2mb" }));
web.use(express.urlencoded({ extended: true, limit: "2mb" }));

// =================== WEB ===================

// Create web user (superadmin only)
web.post(
  "/users",
  protect,
  allowRoles("superadmin"),
  validate(createWebUserSchema),
  registerWebUser
);

// Web login
web.post(
  "/users/login",
  validate(webLoginSchema),
  rateLimitRedis({
    prefix: "rl:web:login",
    windowMs: 60_000,
    max: 5,
    keyFn: (req) => `${(req.body?.email || "").toLowerCase()}|${req.ip}`,
  }),
  requestLogger("web.login", { db: "auth" }),
  loginWebUser
);

// Current web user
web.get("/users/me", protect, requestLogger("web.me", { db: "auth" }), getMe);

// List users (admin/superadmin/developer)
web.get(
  "/users",
  protect,
  allowRoles("admin", "superadmin", "developer"),
  requestLogger("web.users.list", { db: "auth" }),
  getUsers
);

// Logout (stateless audit)
web.post(
  "/users/logout",
  protect,
  requestLogger("web.logout", { db: "auth" }),
  logoutWebUser
);

// =================== MOBILE ===================

// OTP
mobile.post(
  "/otp/request",
  rateLimitRedis({
    prefix: "rl:otp:request",
    windowMs: 60_000,
    max: 3,
    keyFn: (req) => `${req.ip}|${(req.body?.email || "").toLowerCase()}`,
  }),
  requestLogger("mobile.otp.request", { db: "auth" }),
  requestOtp
);

mobile.post(
  "/otp/verify",
  rateLimitRedis({
    prefix: "rl:otp:verify",
    windowMs: 60_000,
    max: 10,
    keyFn: (req) => `${req.ip}|${(req.body?.email || "").toLowerCase()}`,
  }),
  requestLogger("mobile.otp.verify", { db: "auth" }),
  verifyOtp
);

// Link/Unlink DID
mobile.put(
  "/:id/did",
  protect,
  requestLogger("mobile.did.update", { db: "auth" }),
  updateUserDID
);

// Register (requires OTP session)
mobile.post(
  "/users",
  requireOtpSession,
  requestLogger("mobile.register", { db: "auth" }),
  registerMobileUser
);

// Login
mobile.post(
  "/users/login",
  requestLogger("mobile.login", { db: "auth" }),
  loginMobileUser
);

// Current mobile user
mobile.get(
  "/users/me",
  protect,
  requestLogger("mobile.me", { db: "auth" }),
  getMe
);

// Mount subrouters
router.use("/web", web);
router.use("/mobile", mobile);

module.exports = router;
