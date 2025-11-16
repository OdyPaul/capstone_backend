// routes/testing/issueCredentialRoutes.js
const express = require('express');
const router = express.Router();

const { protect, admin } = require('../../middleware/authMiddleware');
const { z, validate, objectId } = require('../../middleware/validate');

const {
  createIssue,
  listIssues,
  deleteIssue,
  preview,
  payAndSign,
  payAndSignByOrderNo,
} = require('../../controllers/testing/issueCredentialController');

const issueItemBase = z
  .object({
    studentId:     objectId().optional(),
    studentNumber: z.string().trim().max(64).optional(),
    templateId: objectId(),
    type:       z.enum(['tor', 'diploma']).optional(),
    purpose:    z.string().trim().max(120),
    expiration: z.union([z.literal('N/A'), z.coerce.date()]).optional(),
    overrides:  z.record(z.any()).optional(),
    amount:     z.number().positive().optional(),
    anchorNow:  z.boolean().optional(),
  })
  .strip();

const issueItem = issueItemBase.refine(
  (v) => v.studentId || v.studentNumber,
  { message: 'Either studentId or studentNumber is required' }
);


// ----- Create (single or batch) -----
router.post(
  '/issue',
  protect, admin,
  validate({ body: z.union([issueItem, z.array(issueItem).min(1).max(200)]) }),
  createIssue
);

// ----- List -----
router.get(
  '/issue',
  protect, admin,
  validate({
    query: z.object({
      type:     z.string().trim().max(50).optional(),
      range:    z.enum(['All','today','1w','1m','6m']).optional(),
      program:  z.string().trim().max(80).optional(),
      q:        z.string().trim().max(64).optional(),
      template: objectId().optional(),
      status:   z.enum(['All','issued','signed','anchored','void']).optional(),
      orderNo:  z.string().trim().max(64).optional(),
      receiptNo:z.string().trim().max(64).optional(),
    }).strip()
  }),
  listIssues
);

// ----- Delete (only while status=issued & unpaid) -----
router.delete(
  '/issue/:id',
  protect, admin,
  validate({ params: z.object({ id: objectId() }).strict() }),
  deleteIssue
);

// ----- Preview payload that will be signed -----
router.get(
  '/issue/:id/preview',
  protect, admin,
  validate({ params: z.object({ id: objectId() }).strict() }),
  preview
);

// ----- Cashier: pay → sign (by id) -----
router.post(
  '/issue/:id/pay',
  protect, admin, // cashier should still be an admin-like role
  validate({
    params: z.object({ id: objectId() }).strict(),
    body: z.object({
      receipt_no:  z.string().trim().max(64),
      receipt_date:z.union([z.coerce.date(), z.string().trim().max(0)]).optional(), // allow empty
      amount:      z.number().positive().optional(),
      anchorNow:   z.boolean().optional(),
    }).strip()
  }),
  payAndSign
);

// ----- Cashier: pay → sign (by order number) -----
router.post(
  '/issue/pay-by-order/:orderNo',
  protect, admin,
  validate({ params: z.object({ orderNo: z.string().trim().max(64) }).strict() }),
  payAndSignByOrderNo
);

module.exports = router;
