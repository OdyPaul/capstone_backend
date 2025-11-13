// routes/mobile/vcRoutes.js
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
  try { if (typeof rateLimitRedis === 'function') return rateLimitRedis(opts) || passthru; }
  catch {}
  return passthru;
};

const RL_PER_USER = (prefix, windowMs, max) =>
  makeRateLimit({
    prefix,
    windowMs,
    max,
    keyGenerator: (req) => (req.user?._id ? `${prefix}:${req.user._id}` : `${prefix}:${req.ip}`),
  });

const RL_CREATE = RL_PER_USER('rl:vc:create', 60_000, 10); // 10 creates/min per user
const RL_MINE   = RL_PER_USER('rl:vc:mine',   30_000, 60); // 60 reads/30s per user
const RL_ADMIN  = makeRateLimit({ prefix: 'rl:vc:admin', windowMs: 60_000, max: 240 });

const PURPOSES = [
  'employment',
  'further studies',
  'board examination / professional licensure',
  'scholarship / grant application',
  'personal / general reference',
  'overseas employment',
  'training / seminar',
];

const makeBodyValidator = (schema) => {
  try {
    if (typeof validate === 'function' && z && schema) {
      return validate({ body: schema });
    }
  } catch {}
  return passthru;
};

const makeParamsValidator = (schema) => {
  try {
    if (typeof validate === 'function' && z && schema) {
      return validate({ params: schema }) || passthru;
    }
  } catch {}
  return passthru;
};

/* --------------------------------- schemas --------------------------------- */
const BodyCreate = z
  ? z
      .object({
        type: z.enum(['TOR', 'DIPLOMA']),
        purpose: z.string().min(3).max(120),
        // ✅ NEW: optional anchor flag (matches what frontend sends & backend expects)
        anchorNow: z.boolean().optional(),
      })
      .passthrough()
  : null;

const ParamsId  = z ? z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) }) : null;
const BodyReview = z ? z.object({ status: z.enum(['approved', 'rejected', 'issued']) }) : null;

/* ---------------------------------- routes --------------------------------- */
// Student: create VC request
router.post('/', protect, RL_CREATE, makeBodyValidator(BodyCreate), ctrl.createVCRequest);

// Student: list own requests
router.get('/mine', protect, RL_MINE, ctrl.getMyVCRequests);

// Admin: list all (+ joins)
router.get('/', protect, admin, RL_ADMIN, ctrl.getAllVCRequests);

// Admin: get one
router.get('/:id', protect, admin, RL_ADMIN, makeParamsValidator(ParamsId), ctrl.getVCRequestById);

// Admin: review (approve/reject/issue)
// (You can leave this even if you "don't use review" now; it just won't be called.)
router.patch(
  '/:id',
  protect,
  admin,
  RL_ADMIN,
  makeParamsValidator(ParamsId),
  makeBodyValidator(BodyReview),
  ctrl.reviewVCRequest
);

// Admin: delete (trash)
router.delete(
  '/:id',
  protect,
  admin,
  RL_ADMIN,
  makeParamsValidator(ParamsId),
  ctrl.deleteVCRequest
);

module.exports = router;
