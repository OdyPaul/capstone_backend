const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');

router.get(
  '/c/:token',
  rateLimitRedis({ prefix: 'rl:claim', windowMs: 60_000, max: 30, keyFn: (req) => req.ip }),
  claimCtrl.redeemClaim
);

module.exports = router;
