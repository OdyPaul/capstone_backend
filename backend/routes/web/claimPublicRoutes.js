const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');

let rateLimitRedis, z, validate;
try { ({ rateLimitRedis } = require('../../middleware/rateLimitRedis')); } catch {}
try { ({ z, validate } = require('../../middleware/validate')); } catch {}

const passthru = (_req, _res, next) => next();
const makeValidator = () => {
  try {
    if (typeof validate === 'function' && z) {
      const mw = validate({ params: z.object({ token: z.string().min(8).max(200) }).strict() });
      return typeof mw === 'function' ? mw : passthru;
    }
  } catch {}
  return passthru;
};
const makeRateLimit = (opts = { prefix: 'rl:claim', windowMs: 60_000, max: 30 }) => {
  try {
    if (typeof rateLimitRedis === 'function') {
      const mw = rateLimitRedis(opts);
      return typeof mw === 'function' ? mw : passthru;
    }
  } catch {}
  return passthru;
};

const RL_SLOW = makeRateLimit({ prefix: 'rl:claim', windowMs: 60_000, max: 120 });

// Public redeem (JSON VC)
router.get('/c/:token', makeValidator(), RL_SLOW, claimCtrl.redeemClaim);

// 🔻 Animated UR endpoints removed
module.exports = router;
