// routes/mobile/vcStatusRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/mobile/vcStatusController');
const { protect } = require('../../middleware/authMiddleware');

let rateLimitRedis;
try { ({ rateLimitRedis } = require('../../middleware/rateLimitRedis')); } catch {}

const RL = rateLimitRedis
  ? rateLimitRedis({
      prefix: 'rl:vc-status',
      windowMs: 60_000,
      max: 180, // allow bursts from wallet syncs
      keyFn: (req) => req.user?._id || req.ip, // per-user throttle
    })
  : (_req, _res, next) => next();

router.post('/vc/status', protect, RL, ctrl.statusBatch);

module.exports = router;
