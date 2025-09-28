const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const {
  createVCRequest,
  getMyVCRequests,
  getAllVCRequests,
  reviewVCRequest,
} = require("../controllers/vcRequestController");
const { protect, admin } = require("../middleware/authMiddleware");

// uploads folder check
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

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

// Student: view requests
router.get("/mine", protect, getMyVCRequests);

// Admin: view all
router.get("/", admin,protect, getAllVCRequests);

// Admin: review
router.put("/:id", protect, admin, reviewVCRequest);

module.exports = router;
