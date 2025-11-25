const express = require('express');
const router = express.Router();

const { protect } = require('../../middleware/authMiddleware');
const {
  createVCRequest,
  getMyVCRequests,
  getVCRequests,
  getVCRequestById,
} = require('../../controllers/mobile/vcRequestController');

// Mobile
router.post('/', protect, createVCRequest);
router.get('/mine', protect, getMyVCRequests);

// Admin (optional)
router.get('/', protect, getVCRequests);
router.get('/:id', protect, getVCRequestById);

module.exports = router;
