// routes/mobile/claimRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');
const { z, validate } = require('../../middleware/validate');

const ctrl = require('../../controllers/mobile/claimQueueController');

const RL_SLOW = rateLimitRedis({ prefix: 'rl:cq', windowMs: 60_000, max: 60 });
const RL_FAST = rateLimitRedis({ prefix: 'rl:cq:redeem', windowMs: 60_000, max: 120 });

router.post(
  '/claim-queue/enqueue',
  protect,
  RL_SLOW,
  validate({ body: z.object({ token: z.string().min(8).max(200), url: z.string().url(), expires_at: z.string().optional() }).strict() }),
  ctrl.enqueue
);

router.post(
  '/claim-queue/enqueue-batch',
  protect,
  RL_SLOW,
  validate({ body: z.object({ items: z.array(z.object({
    token: z.string().min(8).max(200),
    url: z.string().url(),
    expires_at: z.string().optional(),
  })).min(1).max(100) }).strict() }),
  ctrl.enqueueBatch
);

router.get(
  '/claim-queue',
  protect,
  RL_SLOW,
  ctrl.list
);

router.post(
  '/claim-queue/redeem-one',
  protect,
  RL_FAST,
  validate({ body: z.object({ token: z.string().min(8).max(200) }).strict() }),
  ctrl.redeemOne
);

router.post(
  '/claim-queue/redeem-all',
  protect,
  RL_FAST,
  ctrl.redeemAll
);

module.exports = router;
