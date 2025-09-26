const express = require("express");
const multer = require("multer");
const {
  createVCRequest,
  getMyVCRequests,
  getAllVCRequests,
  reviewVCRequest,
  getFaceImage,
  getValidIdImage,
} = require("../controllers/vcRequestController");
const { protect, admin } = require("../middleware/authMiddleware");

const router = express.Router();

// ✅ Store uploads in memory (MongoDB will store buffers)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

// Student: create request with 2 images
router.post(
  "/",
  protect,
  upload.fields([
    { name: "faceImage", maxCount: 1 },
    { name: "validIdImage", maxCount: 1 },
  ]),
  createVCRequest
);

// Student: view own requests
router.get("/mine", protect, getMyVCRequests);

// Admin: view all requests
router.get("/", protect, getAllVCRequests);

// Admin: review a request
router.put("/:id", protect, admin, reviewVCRequest);

// Serve images
router.get("/face/:id", getFaceImage);
router.get("/valid-id/:id", getValidIdImage);

module.exports = router;
