const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const {
  uploadAvatar,
  getAvatar,
  getAvatarById,
  deleteAvatar,
} = require('../controllers/avatarController');

// Use memoryStorage so files stay in RAM
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // max 2 MB
});


// Routes
router.post('/', protect, upload.single('photo'), uploadAvatar);
router.get('/', protect, getAvatar);
router.get('/:id', protect, getAvatarById);
router.delete('/:id', protect, deleteAvatar);

module.exports = router;
