const express = require('express');
const router = express.Router();
const googleCtrl = require('../../controllers/mobile/googleVerify');

// POST /api/mobile/verify-gmail
router.post('/verify-gmail', googleCtrl.verifyGoogleAccount);

// 👇 You were missing this line
module.exports = router;
