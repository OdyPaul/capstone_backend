// routes/web/claimPublicRoutes.js
const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');
const { z, validate } = require('../../middleware/validate');

// Redeem token → VC payload
router.get(
  '/c/:token',
  validate({ params: z.object({ token: z.string().min(8).max(200) }).strict() }),
  rateLimitRedis({ prefix: 'rl:claim', windowMs: 60_000, max: 30, keyFn: (req) => req.ip }),
  claimCtrl.redeemClaim
);

// Public animated QR by token (so the HTML page works without JWT)
router.get(
  '/c/:token/qr-embed/frames',
  rateLimitRedis({ prefix: 'rl:qrmeta', windowMs: 60_000, max: 60, keyFn: (req) => req.ip }),
  claimCtrl.qrEmbedFramesByToken
);
router.get(
  '/c/:token/qr-embed/frame',
  rateLimitRedis({ prefix: 'rl:qrframe', windowMs: 60_000, max: 240, keyFn: (req) => req.ip }),
  claimCtrl.qrEmbedFramePngByToken
);
router.get(
  '/c/:token/qr-embed/page',
  rateLimitRedis({ prefix: 'rl:qrpage', windowMs: 60_000, max: 30, keyFn: (req) => req.ip }),
  claimCtrl.qrEmbedPageByToken
);

module.exports = router;
