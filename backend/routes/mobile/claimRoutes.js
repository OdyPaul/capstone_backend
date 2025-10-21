const express = require('express');
const router = express.Router();
const mobileClaimCtrl =require('../../controllers/mobile/claimController') 

router.get('/claims/:token', mobileProtectOptional, mobileClaimCtrl.redeem);

module.exports = router;