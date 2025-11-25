// backend/routes/common/userRoutes.js
const express = require("express");
const router = express.Router();

const {
  registerWebUser,
  loginWebUser,
  registerMobileUser,
  loginMobileUser,
  getUsers,
  getMe,
  logoutWebUser,
  updateWebUser,
  updateMobileUser,
  deleteMobileUser,
  getMyStudentProfile,
} = require("../../controllers/common/userController");

const {
  requestOtp,
  verifyOtp,
} = require("../../controllers/mobile/otpController");
const { protect, allowRoles } = require("../../middleware/authMiddleware");
const { rateLimitRedis } = require("../../middleware/rateLimitRedis");
const { z, validate } = require("../../middleware/validate");
const requestLogger = require("../../middleware/requestLogger");
const requireOtpSession = require("../../middleware/requireOtpSession");

// ---------- Schemas ----------
const webLoginSchema = {
  body: z
    .object({
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(8).max(200),
    })
    .strip(),
};

const emptyToUndef = (schema) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), schema);

const numberOrUndef = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().int().min(0).max(150)
);

const createWebUserSchema = {
  body: z
    .object({
      username: z.string().trim().min(2).max(100),

      fullName: emptyToUndef(z.string().trim().min(2).max(200)).optional(),
      age: numberOrUndef.optional(),
      address: emptyToUndef(z.string().trim().max(1000)).optional(),
      gender: emptyToUndef(z.enum(["male", "female", "other"])).optional(),

      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(8).max(200),

      contactNo: emptyToUndef(z.string().trim().max(50)).optional(),

      // includes cashier
      role: z.enum(["admin", "superadmin", "developer", "cashier"]).default(
        "admin"
      ),

      // Accept URL or data URI, but treat "" as undefined
      profilePicture: z
        .preprocess(
          (v) => (v === "" || v === null ? undefined : v),
          z.union([z.string().url(), z.string().startsWith("data:image/")])
        )
        .optional(),

      profileImageId: emptyToUndef(
        z.string().regex(/^[a-fA-F0-9]{24}$/)
      ).optional(),
    })
    .strip(),
};

const updateWebUserSchema = {
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  }),
  body: z
    .object({
      username: z.string().trim().min(2).max(100).optional(),
      fullName: z.string().trim().min(2).max(200).optional().nullable(),
      age: z.number().int().min(0).max(150).optional().nullable(),
      address: z.string().trim().max(1000).optional().nullable(),
      gender: z.enum(["male", "female", "other"]).optional().nullable(),
      email: z.string().trim().toLowerCase().email().max(254).optional(),
      password: z.string().min(8).max(200).optional(),
      contactNo: z.string().trim().max(50).optional().nullable(),
      role: z.enum(["admin", "superadmin", "developer", "cashier"]).optional(),
      profilePicture: z
        .union([z.string().url(), z.string().startsWith("data:image/")])
        .optional()
        .nullable(),
      profileImageId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),

      // Required for superadmin update password verification
      currentPassword: z.string().min(1).max(200).optional(),
      passwordCurrent: z.string().min(1).max(200).optional(),
      adminPassword: z.string().min(1).max(200).optional(),
    })
    .strip(),
};

const updateMobileUserSchema = {
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  }),
  body: z
    .object({
      username: z.string().trim().min(2).max(100).optional(),
      fullName: z.string().trim().min(2).max(200).optional().nullable(),
      email: z.string().trim().toLowerCase().email().max(254).optional(),
      password: z.string().min(8).max(200).optional(),
      contactNo: z.string().trim().max(50).optional().nullable(),
      verified: z
        .enum(["unverified", "verified", "rejected"])
        .optional(),
    })
    .strip(),
};

// ---------- Subrouters ----------
const web = express.Router();
const mobile = express.Router();

// Bigger body limit for potential data-URIs
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

// List users (kind=query: web | mobile | all)
web.get(
  "/users",
  protect,
  allowRoles("admin", "superadmin", "developer"),
  requestLogger("web.users.list", { db: "auth" }),
  getUsers
);

// Update web user
web.put(
  "/users/:id",
  protect,
  validate(updateWebUserSchema),
  requestLogger("web.users.update", { db: "auth" }),
  updateWebUser
);

// Update mobile user (admin panel)
web.put(
  "/mobile-users/:id",
  protect,
  allowRoles("admin", "superadmin", "developer"),
  validate(updateMobileUserSchema),
  requestLogger("web.mobileUsers.update", { db: "auth" }),
  updateMobileUser
);

// Delete mobile user (superadmin only)
web.delete(
  "/mobile-users/:id",
  protect,
  allowRoles("superadmin"),
  requestLogger("web.mobileUsers.delete", { db: "auth" }),
  deleteMobileUser
);

// Logout
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

// Register (after OTP)
mobile.post(
  "/users",
  requireOtpSession,
  requestLogger("mobile.register", { db: "auth" }),
  registerMobileUser
);

// Mobile login
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

// ⬇️ NEW: Get logged-in student's linked Student_Data record
mobile.get(
  "/students/me",
  protect,
  requestLogger("mobile.student.me", { db: "students" }),
  getMyStudentProfile
);

// Mount subrouters
router.use("/web", web);
router.use("/mobile", mobile);

module.exports = router;
