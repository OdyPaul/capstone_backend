const express = require('express');
const router = express.Router();

const { protect, admin } = require('../../middleware/authMiddleware');
const pdfCtrl = require('../../controllers/web/pdfController');

// Admin/manual render using Student doc + your Handlebars template
router.get('/tor/:studentId/pdf', protect, admin, pdfCtrl.renderTorPdf);

// Public signed, single-use render (verification portal path)
router.get('/pdf/tor-from-session', pdfCtrl.torFromSessionSigned);

module.exports = router;
