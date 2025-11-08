const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/mobile/vcRequestController');
const { protect, admin } = require('../../middleware/authMiddleware');

let rateLimitRedis, z, validate;
try { ({ rateLimitRedis } = require('../../middleware/rateLimitRedis')); } catch {}
try { ({ z, validate } = require('../../middleware/validate')); } catch {}

/* ---------------------------- helpers / fallbacks ---------------------------- */
const passthru = (_req, _res, next) => next();

const makeRateLimit = (opts = {}) => {
  try {
    if (typeof rateLimitRedis === 'function') {
      const mw = rateLimitRedis(opts);
      return typeof mw === 'function' ? mw : passthru;
    }
  } catch {}
  return passthru;
};

const RL_PER_USER = (prefix, windowMs, max) =>
  makeRateLimit({
    prefix,
    windowMs,
    max,
    // If your rateLimitRedis supports keyGenerator, this will be used;
    // otherwise it will be ignored harmlessly.
    keyGenerator: (req) => (req.user?._id ? `${prefix}:${req.user._id}` : `${prefix}:${req.ip}`),
  });

const RL_CREATE = RL_PER_USER('rl:vc:create', 60_000, 10); // 10 creates/min/user
const RL_MINE   = RL_PER_USER('rl:vc:mine',   30_000, 60); // 60 reads/30s/user
const RL_ADMIN  = makeRateLimit({ prefix: 'rl:vc:admin', windowMs: 60_000, max: 240 });

const makeBodyValidator = (schema) => {
  try {
    if (typeof validate === 'function' && z && schema) {
      const mw = validate({ body: schema.strict?.() ?? schema });
      return typeof mw === 'function' ? mw : passthru;
    }
  } catch {}
  return passthru;
};

const makeParamsValidator = (schema) => {
  try {
    if (typeof validate === 'function' && z && schema) {
      const mw = validate({ params: schema.strict?.() ?? schema });
      return typeof mw === 'function' ? mw : passthru;
    }
  } catch {}
  return passthru;
};

/* --------------------------------- schemas --------------------------------- */
const BodyCreate = z
  ? z.object({ type: z.enum(['TOR', 'DIPLOMA']) })
  : null;

const ParamsId = z
  ? z.object({
      id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a 24-char hex ObjectId'),
    })
  : null;

const BodyReview = z
  ? z.object({ status: z.enum(['approved', 'rejected', 'issued']) })
  : null;

/* ---------------------------------- routes --------------------------------- */
// Student: create VC request (uses req.user.studentId on server)
router.post('/', protect, RL_CREATE, makeBodyValidator(BodyCreate), ctrl.createVCRequest);

// Student: list own requests
router.get('/mine', protect, RL_MINE, ctrl.getMyVCRequests);

// Admin: list all requests (+ joins to user & student profile in controller)
router.get('/', protect, admin, RL_ADMIN, ctrl.getAllVCRequests);

// Admin: get one request
router.get('/:id', protect, admin, RL_ADMIN, makeParamsValidator(ParamsId), ctrl.getVCRequestById);

// Admin: review (approve/reject/issue)
router.patch(
  '/:id',
  protect,
  admin,
  RL_ADMIN,
  makeParamsValidator(ParamsId),
  makeBodyValidator(BodyReview),
  ctrl.reviewVCRequest
);

/* ------------------------------- legacy note ------------------------------- */
// Removed: router.post('/:id/verify', ...)
// Use PATCH /:id with body { status: 'approved' | 'rejected' | 'issued' } instead.

module.exports = router;
