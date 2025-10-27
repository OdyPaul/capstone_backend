// routes/mobile/userRoutes.js
const express = require("express");
const router = express.Router();

const {
  registerMobileUser,
  loginMobileUser,
  getMe,
  updateUserDID,
} = require("../../controllers/common/userController");

const { requestOtp, verifyOtp } = require("../../controllers/mobile/otpController");
const requireOtpSession = require("../../middleware/requireOtpSession");
const { protect } = require("../../middleware/authMiddleware");
const { rateLimitRedis } = require("../../middleware/rateLimitRedis");
const requestLogger = require("../../middleware/requestLogger"); // 👈 add logger

// Throttle OTP to protect the mail provider
router.post(
  "/otp/request",
  rateLimitRedis({
    prefix: "rl:otp:request",
    windowMs: 60_000,
    max: 3,
    keyFn: (req) => `${req.ip}|${(req.body?.email || "").toLowerCase()}`,
  }),
  requestLogger("mobile.otp.request", { db: "auth" }), // 👈 log to Auth DB
  requestOtp
);

router.post(
  "/otp/verify",
  rateLimitRedis({
    prefix: "rl:otp:verify",
    windowMs: 60_000,
    max: 10,
    keyFn: (req) => `${req.ip}|${(req.body?.email || "").toLowerCase()}`,
  }),
  requestLogger("mobile.otp.verify", { db: "auth" }), // 👈 log to Auth DB
  verifyOtp
);

router.put(
  "/:id/did",
  protect,
  requestLogger("mobile.did.update", { db: "auth" }), // 👈 log to Auth DB
  updateUserDID
);

router.post(
  "/users",
  requireOtpSession,
  requestLogger("mobile.register", { db: "auth" }), // 👈 log to Auth DB
  registerMobileUser
); // Register

router.post(
  "/users/login",
  requestLogger("mobile.login", { db: "auth" }), // 👈 log to Auth DB (captures email in meta)
  loginMobileUser
); // Login

router.get(
  "/users/me",
  protect,
  requestLogger("mobile.me", { db: "auth" }), // 👈 log to Auth DB
  getMe
); // Get current user

module.exports = router;
