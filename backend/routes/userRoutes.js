const express = require("express");
const router = express.Router();
const {
  registerWebUser,
  loginWebUser,
  getUsers,
  getMe,
} = require("../controllers/common/userController");
const { protect, admin } = require("../middleware/authMiddleware");

// Web: Register user (staff/admin/etc.)
router.post("/", registerWebUser);

// Web: Login
router.post("/login", loginWebUser);

// Web: Get logged-in user profile
router.get("/me", protect, getMe);

// Web: Get all users (admin only)
router.get("/", protect, admin, getUsers);

module.exports = router;
