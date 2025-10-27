const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const {
  createDraft,
  getDrafts,
  deleteDraft,
} = require('../../controllers/web/draftVcController');
const { z, validate, objectId } = require('../../middleware/validate');
const requestLogger = require('../../middleware/requestLogger');

const draftItem = z.object({
  studentId: objectId(),
  templateId: objectId(),
  type: z.string().trim().max(50),
  purpose: z.string().trim().max(120),
  expiration: z.union([z.literal('N/A'), z.coerce.date()]).optional(),
  overrides: z.record(z.any()).optional(),
  clientTx: z.string().regex(/^\d{7}$/).optional(),
}).strip();

router.post(
  '/draft',
  requestLogger('vc.draft.create', { db: 'vc' }),
  protect, admin,
  validate({ body: z.union([draftItem, z.array(draftItem).min(1).max(50)]) }),
  createDraft
);

router.get(
  '/draft',
  requestLogger('vc.draft.list', { db: 'vc' }),
  protect, admin,
  validate({
    query: z.object({
      type: z.string().trim().max(50).optional(),
      range: z.enum(['All','today','1w','1m','6m']).optional(),
      program: z.string().trim().max(80).optional(),
      q: z.string().trim().max(64).optional(),
      template: objectId().optional(),
      clientTx: z.string().regex(/^\d{7}$/).optional(),
    }).strip()
  }),
  getDrafts
);

router.delete(
  '/draft/:id',
  requestLogger('vc.draft.delete', { db: 'vc' }),
  protect, admin,
  validate({ params: z.object({ id: objectId() }).strict() }),
  deleteDraft
);

module.exports = router;
