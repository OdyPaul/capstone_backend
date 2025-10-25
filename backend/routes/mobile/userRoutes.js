// routes/mobileRoutes.js
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

router.post("/otp/request", requestOtp);
router.post("/otp/verify", verifyOtp);


router.put("/:id/did", protect, updateUserDID);
router.post("/users",requireOtpSession, registerMobileUser);           // Register
router.post("/users/login", loginMobileUser);        // Login
router.get("/users/me", protect, getMe);             // Get current user


module.exports = router;