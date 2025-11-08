let rateLimitRedis, z, validate;
try { ({ rateLimitRedis } = require('../../middleware/rateLimitRedis')); } catch {}
try { ({ z, validate } = require('../../middleware/validate')); } catch {}

const passthru = (_req, _res, next) => next();
const makeRateLimit = (opts = {}) => {
  try { if (typeof rateLimitRedis === 'function') return rateLimitRedis(opts) || passthru; }
  catch {}
  return passthru;
};
const RL_PER_USER = (prefix, windowMs, max) =>
  makeRateLimit({ prefix, windowMs, max, keyGenerator: (req) => req.user?._id ? `${prefix}:${req.user._id}` : `${prefix}:${req.ip}` });

const RL_CREATE = RL_PER_USER('rl:vc:create', 60_000, 10);
const RL_MINE   = RL_PER_USER('rl:vc:mine',   30_000, 60);
const RL_ADMIN  = makeRateLimit({ prefix: 'rl:vc:admin', windowMs: 60_000, max: 240 });

const PURPOSES = [
  "employment",
  "further studies",
  "board examination / professional licensure",
  "scholarship / grant application",
  "personal / general reference",
  "overseas employment",
  "training / seminar",
];

const makeBodyValidator = (schema) => {
  try {
    if (typeof validate === 'function' && z && schema) {
      // IMPORTANT: do NOT force .strict() here; let schema itself control strictness
      return validate({ body: schema });
    }
  } catch {}
  return passthru;
};
const makeParamsValidator = (schema) => {
  try {
    if (typeof validate === 'function' && z && schema) return validate({ params: schema }) || passthru;
  } catch {}
  return passthru;
};

// Accept purpose as string; controller will normalize+enum-check.
// .passthrough() prevents “Unrecognized key” even if a client sends extras.
const BodyCreate = z
  ? z.object({
      type: z.enum(['TOR', 'DIPLOMA']),
      purpose: z.string().min(3).max(120),
    }).passthrough()
  : null;

const ParamsId = z
  ? z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) })
  : null;

const BodyReview = z
  ? z.object({ status: z.enum(['approved','rejected','issued']) })
  : null;

router.post('/', protect, RL_CREATE, makeBodyValidator(BodyCreate), ctrl.createVCRequest);
router.get('/mine', protect, RL_MINE, ctrl.getMyVCRequests);
router.get('/', protect, admin, RL_ADMIN, ctrl.getAllVCRequests);
router.get('/:id', protect, admin, RL_ADMIN, makeParamsValidator(ParamsId), ctrl.getVCRequestById);
router.patch('/:id', protect, admin, RL_ADMIN, makeParamsValidator(ParamsId), makeBodyValidator(BodyReview), ctrl.reviewVCRequest);

module.exports = router;
