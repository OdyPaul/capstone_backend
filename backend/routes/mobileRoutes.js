// routes/mobileRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { protect, admin } = require("../middleware/authMiddleware");

// ---------------- USER CONTROLLERS ----------------
const {
  registerMobileUser,
  loginMobileUser,
  getMe,
} = require("../controllers/common/userController");

// ---------------- VC REQUEST CONTROLLERS ----------------
const {
  createVCRequest,
  getMyVCRequests,
  getAllVCRequests,
  reviewVCRequest,
} = require("../controllers/mobile/vcRequestController");

// ---------------- AVATAR CONTROLLERS ----------------
const {
  uploadAvatar,
  getAvatar,
  getAvatarById,
  deleteAvatar,
} = require("../controllers/mobile/avatarController");

// ---------------- MULTER CONFIG ----------------

// ✅ VC request (disk storage for images)
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const vcStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const vcUpload = multer({ storage: vcStorage });

// ✅ Avatar (memory storage, save in MongoDB)
const avatarStorage = multer.memoryStorage();
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
});

// ---------------- ROUTES ----------------

// === USER ROUTES ===
router.post("/users", registerMobileUser);          // Register
router.post("/users/login", loginMobileUser);       // Login
router.get("/users/me", protect, getMe);      // Get current user

// === VC REQUEST ROUTES ===
router.post(
  "/vc-request",
  protect,
  vcUpload.fields([
    { name: "faceImage", maxCount: 1 },
    { name: "validIdImage", maxCount: 1 },
  ]),
  createVCRequest
);
router.get("/vc-request/mine", protect, getMyVCRequests);
router.get("/vc-request", protect, admin, getAllVCRequests);
router.put("/vc-request/:id", protect, admin, reviewVCRequest);

// === AVATAR ROUTES ===
router.post("/avatar", protect, avatarUpload.single("photo"), uploadAvatar);
router.get("/avatar", protect, getAvatar);
router.get("/avatar/:id", getAvatarById);
router.delete("/avatar/:id", protect, deleteAvatar);

module.exports = router;
