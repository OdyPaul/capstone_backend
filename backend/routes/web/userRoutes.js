const express = require("express");
const router = express.Router();
const {
  registerWebUser,
  loginWebUser,
  getUsers,
  getMe,
} = require("../../controllers/common/userController");
const { protect, admin } = require("../../middleware/authMiddleware");
const { rateLimitRedis } = require("../../middleware/rateLimitRedis");


// Web: Register user (staff/admin/etc.)
router.post("/users", registerWebUser);

// Web: Login
router.post(
  "/users/login",
  rateLimitRedis({
    prefix: "rl:login",
    windowMs: 60_000,
    max: 5,
    keyFn: (req) => req.body?.email || req.ip
  }),
  loginWebUser
);

// Web: Get logged-in user profile
router.get("/users/me", protect, getMe);

// Web: Get all users (admin only)
router.get("/users", protect, admin, getUsers);

module.exports = router;
