const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');
const { protect, admin } = require('../../middleware/authMiddleware');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');

// Admin-only APIs
router.post('/claims', protect, admin, claimCtrl.createClaim);
router.get('/claims', protect, admin, claimCtrl.listClaims);
router.get('/claims/:id', protect, admin, claimCtrl.getClaim);
router.get('/claims/:id/qr.png', protect, admin, rateLimitRedis({ prefix:'rl:qrpng', windowMs:60_000, max:120 }), claimCtrl.qrPng);

// 🔻 Animated QR-embed routes removed
module.exports = router;
