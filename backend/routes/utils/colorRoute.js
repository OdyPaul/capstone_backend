// utils/colorRoutes.js
const express = require('express');
const multer = require('multer');
const { analyzeColors } = require('../../controllers/utils/colorController');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 6, fileSize: 5 * 1024 * 1024 }, // up to 6 files, 5MB each
});

// POST /api/analyzeColors
router.post('/analyzeColors', upload.any(), analyzeColors);

module.exports = router;
