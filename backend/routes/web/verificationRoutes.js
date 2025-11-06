// routes/web/verificationRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/verificationController');

// public endpoints (presentation sessions are intentionally public to verifiers)
router.post('/verification/session', ctrl.createSession);
router.get('/verification/session/:sessionId', ctrl.getSession);       // poll status
router.post('/verification/session/:sessionId/begin', ctrl.beginSession); // verifier fills form
router.post('/verification/session/:sessionId/present', ctrl.submitPresentation); // holder posts VC

module.exports = router;
