// routes/web/claimPublicRoutes.js
const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');

// Optional middlewares (defensive wrap so Express never crashes if missing)
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
const makeRateLimit = () => {
  try {
    if (typeof rateLimitRedis === 'function') {
      const mw = rateLimitRedis({ prefix: 'rl:claim', windowMs: 60_000, max: 30, keyFn: (req) => req.ip });
      return typeof mw === 'function' ? mw : passthru;
    }
  } catch {}
  return passthru;
};

// Public redeem (JSON VC)
router.get('/c/:token', makeValidator(), makeRateLimit(), claimCtrl.redeemClaim);

// Public animated UR frames/page (no JWT)
router.get('/c/:token/qr-embed/frames', makeValidator(), makeRateLimit(), claimCtrl.qrEmbedFramesByToken);
router.get('/c/:token/qr-embed/frame',  makeValidator(), makeRateLimit(), claimCtrl.qrEmbedFramePngByToken);
router.get('/c/:token/qr-embed/page',   makeValidator(), makeRateLimit(), claimCtrl.qrEmbedPageByToken);

module.exports = router;
