// routes/web/vcRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const issueCtrl = require('../../controllers/web/issueController');
const anchorCtrl = require('../../controllers/web/anchorController');
const verifyCtrl = require('../../controllers/web/verificationController');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');
const { z, validate, objectId } = require('../../middleware/validate');
const requestLogger = require('../../middleware/requestLogger');

// -------- VC issuance / listing --------
router.get(
  '/vc/signed',
  protect, admin,
  validate({
    query: z.object({
      q: z.string().trim().max(64).optional(),
      status: z.enum(['active','revoked']).optional(),
      anchorState: z.enum(['unanchored','queued','anchored']).optional(),
    }).strip()
  }),
  issueCtrl.listSigned
);

router.post(
  '/vc/drafts/:id/issue',
  protect, admin,
  validate({
    params: z.object({ id: objectId() }).strict(),
    query: z.object({ anchorNow: z.coerce.boolean().optional() }).strip(),
  }),
  requestLogger('vc.issueFromDraft', { db: 'vc' }),
  issueCtrl.issueFromDraft
);

// -------- Anchoring --------
router.post(
  '/anchor/request-now/:credId',
  protect,
  validate({ params: z.object({ credId: objectId() }).strict() }),
  requestLogger('vc.anchor.requestNow', { db: 'vc' }),
  anchorCtrl.requestNow
);

// ✅ keep audit log for this GET
router.get(
  '/anchor/queue',
  protect, admin,
  validate({
    query: z.object({
      mode: z.enum(['all','now','batch']).optional(),
      approved: z.enum(['all','true','false']).optional(),
    }).strip()
  }),
  requestLogger('vc.anchor.queue', { db: 'vc' }),
  anchorCtrl.listQueue
);

router.post(
  '/anchor/approve',
  protect, admin,
  validate({
    body: z.object({
      credIds: z.array(objectId()).min(1).max(200),
      approved_mode: z.enum(['single','batch'])
    }).strict()
  }),
  requestLogger('vc.anchor.approve', { db: 'vc' }),
  anchorCtrl.approveQueued
);

router.post(
  '/anchor/run-single/:credId',
  protect, admin,
  validate({ params: z.object({ credId: objectId() }).strict() }),
  rateLimitRedis({
    prefix: 'rl:anchor:single',
    windowMs: 60_000,
    max: 10,
    keyFn: (req) => req.user?._id?.toString() || req.ip
  }),
  requestLogger('vc.anchor.runSingle', { db: 'vc' }),
  anchorCtrl.runSingle
);

router.post(
  '/anchor/mint-batch',
  protect, admin,
  validate({ body: z.object({}).strict().optional() }),
  rateLimitRedis({
    prefix: 'rl:anchor:batch',
    windowMs: 60_000,
    max: 4,
    keyFn: (req) => req.user?._id?.toString() || req.ip
  }),
  requestLogger('vc.anchor.mintBatch', { db: 'vc' }),
  anchorCtrl.mintBatch
);

// Back-compat alias → queue behavior
router.post(
  '/anchor/mint-now/:credId',
  protect, admin,
  validate({ params: z.object({ credId: objectId() }).strict() }),
  requestLogger('vc.anchor.mintNow', { db: 'vc' }),
  anchorCtrl.mintNow
);

// -------- Verification --------
router.post(
  '/present/session',
  protect,
  validate({
    body: z.object({
      org: z.string().trim().max(120),
      contact: z.string().trim().max(120).optional(),
      types: z.array(z.string().trim().max(40)).min(1).max(5).optional(),
      ttlHours: z.coerce.number().int().min(1).max(72).optional(),
    }).strip()
  }),
  requestLogger('vc.present.createSession', { db: 'vc' }),
  verifyCtrl.createSession
);

// Public(ish) presentation
router.post(
  '/present/:sessionId',
  validate({
    params: z.object({ sessionId: z.string().regex(/^prs_[a-z0-9]{6,12}$/) }).strict(),
    body: z.object({ credential_id: objectId() }).strict()
  }),
  rateLimitRedis({
    prefix: 'rl:present',
    windowMs: 60_000,
    max: 20,
    keyFn: (req) => req.ip
  }),
  requestLogger('vc.present.submit', { db: 'vc' }),
  verifyCtrl.submitPresentation
);

module.exports = router;
