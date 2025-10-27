const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const ctrl = require('../../controllers/web/vcTemplateController');
const requestLogger = require('../../middleware/requestLogger');

router.post('/',
  requestLogger('vc.template.create', { db: 'vc' }),
  protect, admin, ctrl.createTemplate);

router.get('/',
  requestLogger('vc.template.list', { db: 'vc' }),
  protect, admin, ctrl.listTemplates);

router.get('/:id',
  requestLogger('vc.template.get', { db: 'vc' }),
  protect, admin, ctrl.getTemplate);

router.put('/:id',
  requestLogger('vc.template.update', { db: 'vc' }),
  protect, admin, ctrl.updateTemplate);

router.delete('/:id',
  requestLogger('vc.template.delete', { db: 'vc' }),
  protect, admin, ctrl.deleteTemplate);

router.get('/:id/preview',
  requestLogger('vc.template.preview', { db: 'vc' }),
  protect, admin, ctrl.previewTemplate);

module.exports = router;
