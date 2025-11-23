// backend/routes/web/pdfRoutes.js
const express = require('express');
const router = express.Router();
const pdf = require('../../controllers/web/pdfController');

// Open with sample data straight in the browser
router.get('/pdf/tor', pdf.torSamplePdf);
router.get('/pdf/diploma', pdf.diplomaSamplePdf);

// Generate from real JSON (POST body matches your template field names)
router.post('/pdf/tor', pdf.torGeneratePdf);
router.post('/pdf/diploma', pdf.diplomaGeneratePdf);

module.exports = router;
