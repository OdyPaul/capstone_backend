// routes/web/vcTemplateRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const ctrl = require('../../controllers/web/vcTemplateController');

// CRUD (draft-only)
router.post('/',       protect, admin, ctrl.createTemplate);
router.get('/',        protect, admin, ctrl.listTemplates);
router.get('/:id',     protect, admin, ctrl.getTemplate);
router.put('/:id',     protect, admin, ctrl.updateTemplate);
router.delete('/:id',  protect, admin, ctrl.deleteTemplate);

// Quick preview of attributes
router.get('/:id/preview', protect, admin, ctrl.previewTemplate);

module.exports = router;
