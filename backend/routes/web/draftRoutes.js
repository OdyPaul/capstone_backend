const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const { createUnsignedVC, getUnsignedVCs, deleteUnsignedVC } =
  require('../../controllers/web/unsignedVcController');

// Create one or many drafts
router.post('/draft', protect, admin, createUnsignedVC);

// List drafts (with filters)
router.get('/draft', protect, admin, getUnsignedVCs);

// Delete a draft
router.delete('/draft/:id', protect, admin, deleteUnsignedVC);

module.exports = router;
