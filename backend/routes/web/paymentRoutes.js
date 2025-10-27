// routes/web/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const ctrl = require('../../controllers/web/paymentController');
const { z, validate, objectId } = require('../../middleware/validate');
const requestSchema = {
  body: z.object({
    draftId: objectId(),
    amount: z.coerce.number().positive().max(1_000_000),
    currency: z.enum(['PHP','USD','EUR']).optional(),
    anchorNow: z.boolean().optional(),
    notes: z.string().trim().max(500).optional(),
  }).strip()
};
// Create a payment request for a draft
router.post('/payments/request', protect, admin, validate(requestSchema), ctrl.createRequest);
const markPaidBody = z.object({
  method: z.enum(['cash','gcash','card','other']).optional(),
  notes: z.string().trim().max(500).optional(),
  receipt_no: z.string().trim().toUpperCase().regex(/^[A-Z0-9\-]{3,32}$/),
  receipt_date: z.coerce.date().optional(),
  amount: z.coerce.number().positive().max(1_000_000).optional(),
  anchorNow: z.boolean().optional(),
}).strip();

// Mark as paid (by id)
router.patch('/payments/:id/mark-paid',
  protect, admin,
  validate({ params: z.object({ id: objectId() }).strict(), body: markPaidBody }),
  ctrl.markPaid
);

// Mark as paid (by tx number)
router.post('/payments/tx/:txNo/mark-paid',
  protect, admin,
  validate({
    params: z.object({ txNo: z.string().regex(/^TX-\d{12}-[A-Z0-9]{4}$/) }).strict(),
    body: markPaidBody
  }),
  ctrl.markPaidByTx
);

// List payments (filters: draft, status, tx_no)
router.get('/payments',
  protect, admin,
  validate({
    query: z.object({
      draft: objectId().optional(),
      status: z.enum(['pending','paid','void','consumed']).optional(),
      tx_no: z.string().max(40).optional(),
    }).strip()
  }),
  ctrl.listPayments
);


router.patch('/payments/:id/void',
  protect, admin,
  validate({ params: z.object({ id: objectId() }).strict() }),
  ctrl.voidPayment
);

module.exports = router;
