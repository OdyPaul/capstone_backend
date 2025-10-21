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
console.log('typeof rateLimit:', typeof rateLimit);
console.log('typeof rateLimit():', typeof rateLimit());


//filter/ get signed
router.get('/vc/signed', protect, admin, issueCtrl.listSigned); 
// Issue from draft (admin)
router.post('/vc/drafts/:id/issue', protect, admin, issueCtrl.issueFromDraft);

// Anchor batch (admin or superadmin)
router.post('/anchor/mint-batch', protect, admin, anchorCtrl.mintBatch);
// routes/web/vcRoutes.js
router.post('/anchor/mint-now/:credId', protect, admin, anchorCtrl.mintNow);

// Verification sessions
router.post('/present/session', protect, verifyCtrl.createSession);          // ✅ function
router.post('/present/:sessionId', rateLimit(), verifyCtrl.submitPresentation); // ✅ function

module.exports = router;
