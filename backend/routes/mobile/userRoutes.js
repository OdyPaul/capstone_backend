// routes/mobileRoutes.js
const express = require("express");
const router = express.Router();

const {
  registerMobileUser,
  loginMobileUser,
  getMe,
} = require("../controllers/common/userController");

const { protect, admin } = require("../middleware/authMiddleware");


router.post("/users", registerMobileUser);           // Register
router.post("/users/login", loginMobileUser);        // Login
router.get("/users/me", protect, getMe);             // Get current user


module.exports = router;