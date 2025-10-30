// routes/web/claimPublicRoutes.js
const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');
const { z, validate } = require('../../middleware/validate');

// Public: redeem a claim token → returns VC payload JSON
router.get(
  '/c/:token',
  validate({
    params: z.object({ token: z.string().min(8).max(200) }).strict(),
  }),
  rateLimitRedis({
    prefix: 'rl:claim',
    windowMs: 60_000,
    max: 30,
    keyFn: (req) => req.ip,
  }),
  claimCtrl.redeemClaim
);

module.exports = router;
