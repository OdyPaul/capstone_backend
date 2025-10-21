// routes/.../claims.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const claimCtrl = require('../../controllers/web/claimController');

router.post('/claims', protect, admin, claimCtrl.createClaim);  // create ticket (QR)
router.get('/claims', protect, admin, claimCtrl.listClaims);    // list tickets for table
router.get('/claims/:id', protect, admin, claimCtrl.getClaim);  // optional: view one
router.get('/claims/:id/qr.png', protect, admin, claimCtrl.qrPng); // QR image for modal

// public redeem (wallet scans QR)
router.get('/c/:token', claimCtrl.redeemClaim);

module.exports = router;
