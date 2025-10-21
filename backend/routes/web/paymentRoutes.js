// routes/web/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const ctrl = require('../../controllers/web/paymentController');

// Create a payment request for a draft
router.post('/payments/request', protect, admin, ctrl.createRequest);

// Mark as paid (by id)
router.patch('/payments/:id/mark-paid', protect, admin, ctrl.markPaid);

// Mark as paid (by tx number)
router.post('/payments/tx/:txNo/mark-paid', protect, admin, ctrl.markPaidByTx);

// List payments (filters: draft, status, tx_no)
router.get('/payments', protect, admin, ctrl.listPayments);

router.patch('/payments/:id/void', protect, admin, ctrl.voidPayment);

module.exports = router;
