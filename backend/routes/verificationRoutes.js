const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  uploadVerification,
  getMyVerifications,
  getAllVerifications,
  reviewVerification,
} = require('../controllers/verificationController');
const { protect, admin } = require('../middleware/authMiddleware');

// uploads folder check
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  },
});
const upload = multer({ storage });

// User upload (face or valid ID)
router.post('/:purpose', protect, upload.single('file'), uploadVerification);

// User can see their submissions
router.get('/', protect, getMyVerifications);

// Admin: see all submissions
router.get('/admin', protect, admin, getAllVerifications);

// Admin: approve/reject
router.put('/:id', protect, admin, reviewVerification);

module.exports = router;
