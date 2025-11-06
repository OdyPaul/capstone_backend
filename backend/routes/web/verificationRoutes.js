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
  params: z.object({ sessionId: z.string().min(6).max(64) }).strict(),
});
const vCreateBody = validate({
  body: z.object({
    org: z.string().max(120).optional(),
    contact: z.string().max(120).optional(),
    types: z.array(z.string().max(40)).min(1).max(8).optional(),
    ttlHours: z.number().int().min(1).max(168).optional(),
  }).strict()
});
const vBeginBody = validate({
  body: z.object({
    org: z.string().max(120).optional(),
    contact: z.string().max(120).optional(),
    purpose: z.string().max(240).optional(),
  }).strict()
});
const vPresentBody = validate({
  body: z.object({
    credential_id: z.string().max(64).optional(),
    payload: z.object({
      jws: z.string(),
      salt: z.string(),
      digest: z.string(),
      anchoring: z.any().optional(),
      alg: z.string().optional(),
      kid: z.string().optional(),
    }).partial().refine(o => o.jws && o.salt && o.digest, 'missing fields').optional(),
  }).strict()
});

// ---- Multer (in-memory) for QR images
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_500_000, files: 1 }, // ~1.5MB
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
  upload.single('qr'), // expects multipart field "qr" (or body.imageDataUrl as fallback)
  ctrl.presentFromQrImage
);

module.exports = router;
