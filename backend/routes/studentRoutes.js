const express = require("express");
const router = express.Router();
const { getStudentPassing, getStudentTor, searchStudent, findStudent } = require("../controllers/web/studentController");
const { protect } = require("../middleware/authMiddleware");
const { rateLimitRedis } = require("../middleware/rateLimitRedis");

// passing: 60/min per user/IP
router.get("/passing",
  protect,
  rateLimitRedis({ prefix:'rl:student:passing', windowMs:60_000, max:60, keyFn: (req)=> req.user?._id?.toString() || req.ip }),
  getStudentPassing
);

// search: 30/min per user/IP
router.get("/search",
  protect,
  rateLimitRedis({ prefix:'rl:student:search', windowMs:60_000, max:30, keyFn: (req)=> req.user?._id?.toString() || req.ip }),
  searchStudent
);

router.get("/:id/tor", protect, getStudentTor);
router.get("/:id", protect, findStudent);

module.exports = router;
