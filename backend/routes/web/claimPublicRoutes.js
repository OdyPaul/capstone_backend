// routes/web/claimPublicRoutes.js
const express = require('express');
const router = express.Router();
const claimCtrl = require('../../controllers/web/claimController');

// Public redeem endpoint for wallets/scanners
router.get('/c/:token', claimCtrl.redeemClaim);

module.exports = router;
