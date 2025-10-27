// controllers/mobile/claimController.js
const claimCtrl = require('../web/claimController'); // reuse the signed implementation

// Re-export the signed redeem handler so mobile and public share one code path.
exports.redeem = claimCtrl.redeemClaim;
