const express = require('express');
const router = express.Router();
const { protect, admin } = require('../../middleware/authMiddleware');

router.get('/settings/public', protect, admin, (req, res) => {
  res.json({
    issuerName: process.env.ISSUER_NAME,
    issuerDID: process.env.ISSUER_DID,
    signingAlg: process.env.VC_SIGNING_ALG,
    publicKey:  process.env.VC_PUBLIC_KEY_PEM ? 'present' : 'missing'
  });
});

module.exports = router;
