const express = require('express');
const router = express.Router();
const vcCtrl = require('../../controllers/mobile/vcController');

router.post('/', vcCtrl.createVCRequest);
router.post('/:id/verify', vcCtrl.verifyRequest); // admin verifies
// add GET list, GET single, etc. as needed

module.exports = router;
