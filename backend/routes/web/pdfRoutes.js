const express = require('express');
const router = express.Router();

// These can stay if you still use them elsewhere on this router
const { protect, admin } = require('../../middleware/authMiddleware');

// Import the actual handler that exists in the controller
const {
  torFromSessionSigned, // <— exported by pdfController.js
} = require('../../controllers/web/pdfController');

// --- If you still have an old TOR-by-student route, either remove it,
// --- or keep a small stub so the router always receives a function.

// OLD (caused crash because pdfCtrl.renderTorPdf was undefined):
// router.get('/tor/:studentId/pdf', protect, admin, pdfCtrl.renderTorPdf);

// Option A: remove the old route entirely (recommended)

// Option B: keep a harmless stub so routes remain valid
router.get('/tor/:studentId/pdf', protect, admin, (req, res) => {
  res.status(410).send('Deprecated: use /api/web/pdf/tor-from-session signed link instead.');
});

// Signed, short-lived, single-use TOR render endpoint (public; access is via signed query)
router.get('/pdf/tor-from-session', torFromSessionSigned);

module.exports = router;
