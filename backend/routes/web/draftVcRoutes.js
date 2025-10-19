// routes/web/draftVcRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const {
  createDraft,
  getDrafts,
  deleteDraft,
} = require('../../controllers/web/draftVcController');

// Create one or many drafts
router.post('/draft', protect, admin, createDraft);

// List drafts (supports ?type=&range=&program=&q=&template=)
router.get('/draft', protect, admin, getDrafts);

// Delete a draft
router.delete('/draft/:id', protect, admin, deleteDraft);

module.exports = router;
