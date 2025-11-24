// routes/web/verificationRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/verificationController');

const { rateLimitRedis } = require('../../middleware/rateLimitRedis');
const { z, validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/authMiddleware');

// ---- Redis rate limits
const RL_CREATE  = rateLimitRedis({ prefix: 'rl:veri:create',  windowMs: 60_000, max: 20 });
const RL_BEGIN   = rateLimitRedis({ prefix: 'rl:veri:begin',   windowMs: 60_000, max: 60 });
const RL_POLL    = rateLimitRedis({ prefix: 'rl:veri:poll',    windowMs: 60_000, max: 240 });
const RL_PRESENT = rateLimitRedis({ prefix: 'rl:veri:present', windowMs: 60_000, max: 60 });

// ---- Validation
const vSessionParam = validate({
  params: z.object({
    sessionId: z.string().regex(/^(?:prs|ors)_[A-Za-z0-9\-_]{6,32}$/),
  }).strict(),
});

const vCreateBody = validate({
  body: z.object({
    org: z.string().max(120).optional(),
    contact: z.string().max(120).optional(),
    types: z.array(z.string().max(40)).min(1).max(8).optional(),
    ttlHours: z.coerce.number().int().min(1).max(168).optional(),
    ui_base: z.string().max(300).optional(),
    credential_id: z.string().max(256).optional(),
  }).strict(),
});

const PresentWithDecision = z.object({
  decision: z.literal('deny'),
}).strict();

const vBeginBody = validate({
  body: z.object({
    org: z.string().max(120).optional(),
    contact: z.string().max(120).optional(),
    purpose: z.string().max(240).optional(),
  }).strict(),
});

const PresentWithId = z.object({
  credential_id: z.string().max(256),
  nonce: z.string().max(180).optional(),
}).strict();

const PresentWithPayload = z.object({
  payload: z.object({
    jws: z.string(),
    salt: z.string(),
    digest: z.string(),
    anchoring: z.any().optional(),
    alg: z.string().optional(),
    kid: z.string().optional(),
    jwk: z.any().optional(),
  }).strict(),
  nonce: z.string().max(180).optional(),
}).strict();

const vPresentBody = validate({
  body: z.union([PresentWithDecision, PresentWithId, PresentWithPayload]),
});

// ---- Routes (NO leading /api — we’ll mount under /api in server.js)

// Holder (mobile) creates a session → must be authenticated to link to user
router.post('/verification/session', protect, RL_CREATE, vCreateBody, ctrl.createSession);

// Verifier begins (web portal, usually unauthenticated)
router.post('/verification/session/:sessionId/begin', RL_BEGIN, vSessionParam, vBeginBody, ctrl.beginSession);

// Verifier or holder polls
router.get('/verification/session/:sessionId', RL_POLL, vSessionParam, ctrl.getSession);

// Holder presents
router.post('/verification/session/:sessionId/present', RL_PRESENT, vSessionParam, vPresentBody, ctrl.submitPresentation);

// QR for wallet scan
router.get('/verification/session/:sessionId/qr.png', RL_POLL, vSessionParam, ctrl.sessionQrPng);

// Mobile wallet: list pending consent requests (needs auth)
router.get('/verification/pending', protect, ctrl.listPending);

module.exports = router;
