// routes/web/unsignedVcRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const {
  createUnsignedVC,
  getUnsignedVCs,
  deleteUnsignedVC,
} = require('../../controllers/web/unsignedVcController');

// Create one or many drafts
router.post('/draft', protect, admin, createUnsignedVC);

// List drafts (supports ?type=&range=&program=&q=)
router.get('/draft', protect, admin, getUnsignedVCs);

// Delete a draft
router.delete('/draft/:id', protect, admin, deleteUnsignedVC);

module.exports = router;
