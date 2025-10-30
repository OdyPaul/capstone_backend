// routes/web/claimPublicRoutes.js
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

// Lower-volume endpoints
const RL_SLOW = makeRateLimit({ prefix: 'rl:claim', windowMs: 60_000, max: 120 });

// High-volume frames endpoint (2–10 fps * 60 sec)
const RL_FAST = makeRateLimit({ prefix: 'rl:claim:frame', windowMs: 60_000, max: 1200 });

// Public redeem (JSON VC)
router.get('/c/:token', makeValidator(), RL_SLOW, claimCtrl.redeemClaim);

// Public animated UR frames/page (no JWT)
router.get('/c/:token/qr-embed/frames', makeValidator(), RL_SLOW, claimCtrl.qrEmbedFramesByToken);
router.get('/c/:token/qr-embed/frame',  makeValidator(), RL_FAST, claimCtrl.qrEmbedFramePngByToken);
router.get('/c/:token/qr-embed/page',   makeValidator(), RL_SLOW, claimCtrl.qrEmbedPageByToken);

module.exports = router;
