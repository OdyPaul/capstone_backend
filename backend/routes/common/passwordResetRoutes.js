// backend/routes/common/passwordResetRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/common/passwordResetController');

// Shared for both web & mobile users
router.post('/password/forgot', ctrl.requestResetOtp);
router.post('/password/verify', ctrl.verifyResetOtp);
router.post('/password/reset', ctrl.applyNewPassword);

module.exports = router;
