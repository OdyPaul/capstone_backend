// routes/web/verificationRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/verificationController');

// create a session (can be protected or public)
router.post('/api/verification/session', ctrl.createSession);

// verifier fills org/contact/purpose
router.post('/api/verification/session/:sessionId/begin', ctrl.beginSession);

// poll session
router.get('/api/verification/session/:sessionId', ctrl.getSession);

// holder presents (credential_id OR payload)
router.post('/api/verification/session/:sessionId/present', ctrl.submitPresentation);

module.exports = router;
