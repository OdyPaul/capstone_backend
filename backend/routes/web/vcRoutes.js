// routes/web/vcRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const issueCtrl = require('../../controllers/web/issueController');
const anchorCtrl = require('../../controllers/web/anchorController');
const verifyCtrl = require('../../controllers/web/verificationController');
const rateLimit = require('../../middleware/rateLimit'); // ✅ no braces

// 🔎 sanity logs (remove after it starts once)
console.log('typeof verifyCtrl.createSession:', typeof verifyCtrl.createSession);
console.log('typeof verifyCtrl.submitPresentation:', typeof verifyCtrl.submitPresentation);
console.log('typeof rateLimit():', typeof rateLimit());

// -------- VC issuance / listing --------
router.get('/vc/signed', protect, admin, issueCtrl.listSigned);
router.post('/vc/drafts/:id/issue', protect, admin, issueCtrl.issueFromDraft);

// -------- Anchoring --------
// Queue a "mint now" request (end users or admins can hit this)
router.post('/anchor/request-now/:credId', protect, anchorCtrl.requestNow);

// Admin review queue
router.get('/anchor/queue', protect, admin, anchorCtrl.listQueue);
router.post('/anchor/approve', protect, admin, anchorCtrl.approveQueued);

// Execute anchoring
router.post('/anchor/run-single/:credId',rateLimit(), protect, admin, anchorCtrl.runSingle);
router.post('/anchor/mint-batch',rateLimit(), protect, admin, anchorCtrl.mintBatch);

// Back-compat: old route points to queue behavior
router.post('/anchor/mint-now/:credId', protect, admin, anchorCtrl.mintNow);

// -------- Verification --------
router.post('/present/session', protect, verifyCtrl.createSession);
router.post('/present/:sessionId', rateLimit(), verifyCtrl.submitPresentation);

module.exports = router;
