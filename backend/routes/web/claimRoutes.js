// routes/web/claimRoutes.js
const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');
const { protect, admin } = require('../../middleware/authMiddleware');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');

// Admin-only APIs
router.post('/claims', protect, admin, claimCtrl.createClaim);
router.get('/claims', protect, admin, claimCtrl.listClaims);
router.get('/claims/:id', protect, admin, claimCtrl.getClaim);
router.get('/claims/:id/qr.png', protect, admin, claimCtrl.qrPng);

// Public QR-embed endpoints (rate limited) so <a> can work without headers
router.get(
  '/claims/:id/qr-embed/frames',
  rateLimitRedis({ prefix: 'rl:qre', windowMs: 60_000, max: 60, keyFn: (req) => req.ip }),
  claimCtrl.qrEmbedFrames
);

router.get(
  '/claims/:id/qr-embed/frame',
  rateLimitRedis({ prefix: 'rl:qre', windowMs: 60_000, max: 120, keyFn: (req) => req.ip }),
  claimCtrl.qrEmbedFramePng
);

router.get(
  '/claims/:id/qr-embed/page',
  rateLimitRedis({ prefix: 'rl:qrepg', windowMs: 60_000, max: 20, keyFn: (req) => req.ip }),
  claimCtrl.qrEmbedPage
);

module.exports = router;
