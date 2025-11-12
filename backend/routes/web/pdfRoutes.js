// routes/pdfRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const pdfCtrl = require('../../controllers/web/pdfController');

router.get('/tor/:studentId/pdf', protect, admin, pdfCtrl.renderTorPdf);

router.get('/tor/from-session/pdf-signed', pdfCtrl.renderTorPdfFromSessionSigned);

module.exports = router;
