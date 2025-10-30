const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');
const { protect, admin } = require('../../middleware/authMiddleware');

router.post('/claims', protect, admin, claimCtrl.createClaim);
router.get('/claims', protect, admin, claimCtrl.listClaims);
router.get('/claims/:id', protect, admin, claimCtrl.getClaim);
router.get('/claims/:id/qr.png', protect, admin, claimCtrl.qrPng);
router.get('/claims/:id/qr-embed/frames', protect, admin, claimCtrl.qrEmbedFrames);
router.get('/claims/:id/qr-embed/frame', protect, admin, claimCtrl.qrEmbedFramePng);
router.get('/claims/:id/qr-embed/page', protect, admin, claimCtrl.qrEmbedPage);

module.exports = router;
