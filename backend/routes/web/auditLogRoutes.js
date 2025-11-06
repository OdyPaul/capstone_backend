// routes/web/auditLogRoutes.js
const express = require('express');
const router = express.Router();

const { protect, allowRoles } = require('../../middleware/authMiddleware');
const { z, validate } = require('../../middleware/validate');
const { listAuditLogs } = require('../../controllers/web/auditLog');

const querySchema = z.object({
  page:   z.coerce.number().int().min(1).optional(),
  limit:  z.coerce.number().int().min(1).max(200).optional(),
  q:      z.string().trim().max(64).optional(),
  type:   z.enum(['all','login','draft','issue','anchor']).optional(),
  actorId:z.string().length(24).optional(), // ObjectId hex
  from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
  to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(['all','vc','auth','students']).optional(),
}).strip();

router.get(
  '/audit-logs',
  protect,
  allowRoles('superadmin', 'developer'),
  validate({ query: querySchema }),
  listAuditLogs
);

module.exports = router;
