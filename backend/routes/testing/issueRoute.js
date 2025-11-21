// routes/testing/issueRoute.js
const express = require('express');
const router = express.Router();
const issueController = require('../../controllers/testing/issueController');

// Create one or batch issue
// POST /api/web/issuance/issue
router.post('/issue', issueController.createIssue);

// List issues
// GET /api/web/issuance/issue
router.get('/issue', issueController.listIssues);

// Preview VC payload (before signing)
// GET /api/web/issuance/issue/:id/preview
router.get('/issue/:id/preview', issueController.preview);

// Cashier: pay + sign by issue id
// POST /api/web/issuance/issue/:id/pay
router.post('/issue/:id/pay', issueController.payAndSign);

// Cashier: pay + sign by order number
// POST /api/web/issuance/issue/order/:orderNo/pay
router.post('/issue/order/:orderNo/pay', issueController.payAndSignByOrderNo);

// Delete issue (only if status=issued & unpaid)
// DELETE /api/web/issuance/issue/:id
router.delete('/issue/:id', issueController.deleteIssue);

module.exports = router;
