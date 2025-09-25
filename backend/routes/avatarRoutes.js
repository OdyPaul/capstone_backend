// routes/avatarRoutes.js
const express = require("express");
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");
const {
  uploadAvatar,
  getAvatar,
  getAvatarById,
  deleteAvatar,
} = require("../controllers/avatarController");

const router = express.Router();

// ✅ Store uploads in memory (MongoDB will handle persistence)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
});

// ---------------- ROUTES ----------------

// Upload or replace avatar
router.post("/", protect, upload.single("photo"), uploadAvatar);

// Get logged-in user's avatar (latest)
router.get("/", protect, getAvatar);

// Get avatar by MongoDB _id (useful for <Image uri>)
router.get("/:id", getAvatarById); // ❌ no protect → allow public fetch

// Delete avatar by id (owner or admin only, handled in controller)
router.delete("/:id", protect, deleteAvatar);

module.exports = router;
