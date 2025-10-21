// routes/web/claimAdminRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');
const claimCtrl = require('../../controllers/web/claimController');

router.post('/claims', protect, admin, claimCtrl.createClaim);
router.get('/claims', protect, admin, claimCtrl.listClaims);
router.get('/claims/:id', protect, admin, claimCtrl.getClaim);
router.get('/claims/:id/qr.png', protect, admin, claimCtrl.qrPng);

module.exports = router;
