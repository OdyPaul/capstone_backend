const express = require('express');
const router = express.Router();
const { issueVC } = require('../controllers/web/vcController');
const { createUnsignedVC, getUnsignedVCs } = require('../controllers/web/unsignedController');

// Save unsigned VC drafts
router.post('/draft', createUnsignedVC);

// Get all drafts for issuance page
router.get('/draft', getUnsignedVCs);

// Sign & issue final VC
router.post('/:id/issue', issueVC);

module.exports = router;
