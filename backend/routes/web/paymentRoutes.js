// routes/web/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const ctrl = require('../../controllers/web/paymentController');

// Create a payment request for a draft
router.post('/payments/request', protect, admin, ctrl.createRequest);

// Mark as paid (cashier)
router.patch('/payments/:id/mark-paid', protect, admin, ctrl.markPaid);
// or by tx number (handy at cashier window)
router.patch('/payments/by-tx/:txNo/mark-paid', protect, admin, ctrl.markPaidByTx);

// Void a payment (before issuance)
router.patch('/payments/:id/void', protect, admin, ctrl.voidPayment);

// List payments (filters: draft, status, tx_no)
router.get('/payments', protect, admin, ctrl.listPayments);

module.exports = router;
