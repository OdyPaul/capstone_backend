const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');

const { z, validate } = require('../../middleware/validate');

router.get(
  '/c/:token',
  validate({ params: z.object({
    token: z.string().min(8).max(200) // adjust if you know exact length
  }).strict() }),
  rateLimitRedis({ prefix: 'rl:claim', windowMs: 60_000, max: 30, keyFn: (req) => req.ip }),
  claimCtrl.redeemClaim
);
router.post('/claims', claimCtrl.createClaim);
router.get('/claims/:id/qr-embed/frames', claimCtrl.qrEmbedFrames);
router.get('/claims/:id/qr-embed/frame',  claimCtrl.qrEmbedFramePng);
router.get('/claims/:id/qr-embed/page',   claimCtrl.qrEmbedPage);

module.exports = router;
