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

// Throttle OTP to protect the mail provider
router.post(
  "/otp/request",
  rateLimitRedis({
    prefix:'rl:otp:request',
    windowMs:60_000,
    max:3,
    keyFn: (req)=> `${req.ip}|${(req.body?.email||'').toLowerCase()}`
  }),
  requestOtp
);

router.post(
  "/otp/verify",
  rateLimitRedis({
    prefix:'rl:otp:verify',
    windowMs:60_000,
    max:10,
    keyFn: (req)=> `${req.ip}|${(req.body?.email||'').toLowerCase()}`
  }),
  verifyOtp
);

router.put("/:id/did", protect, updateUserDID);
router.post("/users", requireOtpSession, registerMobileUser); // Register
router.post("/users/login", loginMobileUser);                 // Login
router.get("/users/me", protect, getMe);                      // Get current user

module.exports = router;
