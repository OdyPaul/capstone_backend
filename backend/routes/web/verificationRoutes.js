// routes/web/verificationRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/verificationController');

const { rateLimitRedis } = require('../../middleware/rateLimitRedis');
const { z, validate } = require('../../middleware/validate');
const multer = require('multer');

// ---- Redis rate limits (tune as needed)
const RL_CREATE  = rateLimitRedis({ prefix: 'rl:veri:create',  windowMs: 60_000, max: 20 });
const RL_BEGIN   = rateLimitRedis({ prefix: 'rl:veri:begin',   windowMs: 60_000, max: 60 });
const RL_POLL    = rateLimitRedis({ prefix: 'rl:veri:poll',    windowMs: 60_000, max: 240 });
const RL_PRESENT = rateLimitRedis({ prefix: 'rl:veri:present', windowMs: 60_000, max: 60 });
const RL_UPLOAD  = rateLimitRedis({ prefix: 'rl:veri:upload',  windowMs: 60_000, max: 30 });

// ---- Validation
const vSessionParam = validate({
  params: z.object({
    // e.g. prs_abCdEf12 (base64url of 8 chars after prefix); loosen as needed
    sessionId: z.string().regex(/^prs_[A-Za-z0-9\-_]{6,32}$/),
  }).strict(),
});

const vCreateBody = validate({
  body: z.object({
    org: z.string().max(120).optional(),
    contact: z.string().max(120).optional(),
    types: z.array(z.string().max(40)).min(1).max(8).optional(),
    ttlHours: z.coerce.number().int().min(1).max(168).optional(), // ← coerce
  }).strict(),
});

const vBeginBody = validate({
  body: z.object({
    org: z.string().max(120).optional(),
    contact: z.string().max(120).optional(),
    purpose: z.string().max(240).optional(),
  }).strict(),
});

// Either credential_id OR payload (not both, not neither)
const PresentWithId = z.object({
  credential_id: z.string().max(64),
  payload: z.undefined().optional(),
}).strict();

const PresentWithPayload = z.object({
  credential_id: z.undefined().optional(),
  payload: z.object({
    jws: z.string(),
    salt: z.string(),
    digest: z.string(),
    anchoring: z.any().optional(),
    alg: z.string().optional(),
    kid: z.string().optional(),
  }).strict(),
}).strict();

const vPresentBody = validate({
  body: z.union([PresentWithId, PresentWithPayload]),
});

// ---- Multer (in-memory) for QR images
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1_500_000,   // ~1.5MB file
    files: 1,
    fields: 5,
    fieldSize: 1_500_000,  // in case you ever accept imageDataUrl text fallback
  },
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(png|jpeg|jpg|webp)/i.test(file.mimetype);
    cb(ok ? null : new Error('unsupported_file_type'), ok);
  },
});

// ---- Routes
router.post('/api/verification/session', RL_CREATE, vCreateBody, ctrl.createSession);

router.post('/api/verification/session/:sessionId/begin', RL_BEGIN, vSessionParam, vBeginBody, ctrl.beginSession);

router.get('/api/verification/session/:sessionId', RL_POLL, vSessionParam, ctrl.getSession);

router.post('/api/verification/session/:sessionId/present', RL_PRESENT, vSessionParam, vPresentBody, ctrl.submitPresentation);

// NEW: upload QR image instead of scanning
router.post(
  '/api/verification/session/:sessionId/present-qr',
  RL_UPLOAD,
  vSessionParam,
  upload.single('qr'), // expects multipart field "qr"
  ctrl.presentFromQrImage
);

// ---- Multer & upload error translator → JSON
router.use((err, _req, res, next) => {
  if (!err) return next();
  // Multer built-ins
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, reason: 'file_too_large' });
    return res.status(400).json({ ok: false, reason: String(err.code || 'upload_error') });
  }
  // Our fileFilter custom error
  if (err.message === 'unsupported_file_type') {
    return res.status(415).json({ ok: false, reason: 'unsupported_file_type' });
  }
  return next(err);
});

module.exports = router;
