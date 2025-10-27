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
const { z, validate } = require('../../middleware/validate');
const requestLogger = require('../../middleware/requestLogger');

const loginSchema = {
  body: z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(200),
  }).strip() // drop unexpected keys quietly (or use .strict() to reject)
};


// Web: Register user (staff/admin/etc.)
router.post("/users", registerWebUser);

router.post(
  "/users/login",
  validate(loginSchema),
  rateLimitRedis({
    prefix: "rl:login",
    windowMs: 60_000,
    max: 5,
    keyFn: (req) => `${req.body.email}|${req.ip}`
  }),
  requestLogger('auth.login'),
  loginWebUser
);

// Web: Get logged-in user profile
router.get("/users/me", protect, getMe);

// Web: Get all users (admin only)
router.get("/users", protect, admin, getUsers);

module.exports = router;
