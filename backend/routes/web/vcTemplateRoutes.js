// routes/web/vcTemplateRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const ctrl = require('../../controllers/web/vcTemplateController');
const requestLogger = require('../../middleware/requestLogger');

// Create / Update / Delete — audited
router.post('/',      protect, admin, requestLogger('vc.template.create', { db: 'vc' }), ctrl.createTemplate);
router.put('/:id',    protect, admin, requestLogger('vc.template.update', { db: 'vc' }), ctrl.updateTemplate);
router.delete('/:id', protect, admin, requestLogger('vc.template.delete', { db: 'vc' }), ctrl.deleteTemplate);

// GETs — no audit log
router.get('/',           protect, admin, ctrl.listTemplates);
router.get('/:id',        protect, admin, ctrl.getTemplate);
router.get('/:id/preview',protect, admin, ctrl.previewTemplate);

module.exports = router;
