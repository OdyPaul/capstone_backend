// routes/web/claimPublicRoutes.js
const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');

// Try loading optional middlewares. If not present / mis-exported, we degrade gracefully.
let rateLimitRedis;
try {
  ({ rateLimitRedis } = require('../../middleware/rateLimitRedis'));
} catch (e) {
  rateLimitRedis = null;
}

let z, validate;
try {
  ({ z, validate } = require('../../middleware/validate'));
} catch (e) {
  z = null;
  validate = null;
}

const passthru = (_req, _res, next) => next();

function makeValidator() {
  try {
    if (typeof validate === 'function' && z && typeof z.object === 'function') {
      const mw = validate({
        params: z.object({ token: z.string().min(8).max(200) }).strict(),
      });
      return typeof mw === 'function' ? mw : passthru;
    }
  } catch (_) {}
  return passthru;
}

function makeRateLimit() {
  try {
    if (typeof rateLimitRedis === 'function') {
      const mw = rateLimitRedis({
        prefix: 'rl:claim',
        windowMs: 60_000,
        max: 30,
        keyFn: (req) => req.ip,
      });
      return typeof mw === 'function' ? mw : passthru;
    }
  } catch (_) {}
  return passthru;
}

// IMPORTANT: each arg must be a function; we wrap them to guarantee that.
router.get('/c/:token', makeValidator(), makeRateLimit(), claimCtrl.redeemClaim);

module.exports = router;
