// routes/common/userImageRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');

const { protect } = require('../../middleware/authMiddleware');
const {
  uploadUserProfileImage,
  attachUserProfileImage,
  deleteUserProfileImage
} = require('../../controllers/common/userImageController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Upload a profile image (staged)
router.post('/user-profile/upload', protect, upload.single('file'), uploadUserProfileImage);

// Attach the image to a specific user (superadmin → anyone; normal user → self)
router.post('/user-profile/attach', protect, attachUserProfileImage);

// Optional: delete
router.delete('/user-profile/:id', protect, deleteUserProfileImage);

module.exports = router;
