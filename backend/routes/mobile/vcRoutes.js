const express = require('express');
const router = express.Router();
const vcCtrl = require('../../controllers/mobile/vcController');
const { protect, admin } = require("../../middleware/authMiddleware");

router.post('/', vcCtrl.createVCRequest);
router.post('/:id/verify', vcCtrl.verifyRequest); // admin verifies
// add GET list, GET single, etc. as needed

router.get('/', protect, vcCtrl.getVCRequests);       // list all
router.get('/:id',protect, vcCtrl.getVCRequestById); // single request

module.exports = router;
