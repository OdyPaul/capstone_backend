// controllers/mobile/claimController.js
const asyncHandler = require('express-async-handler');
const ClaimTicket = require('../../models/web/claimTicket');
const SignedVC = require('../../models/web/signedVcModel');

exports.redeem = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const t = await ClaimTicket.findOne({ token });
  if (!t) { res.status(404); throw new Error('Invalid claim token'); }
  if (t.used_at) { res.status(409); throw new Error('Token already used'); }
  if (t.expires_at < new Date()) { res.status(410); throw new Error('Token expired'); }

  const vc = await SignedVC.findById(t.cred_id).lean();
  if (!vc) { res.status(404); throw new Error('Credential not found'); }

  // Mark as used (single-use). If you want multiple downloads, skip this line.
  t.used_at = new Date(); await t.save();

  // 🔴 TODAY your artifact is NOT signed. You return raw vc_payload + digest/salt.
  // ✅ BETTER: return a signed artifact (JWS or SD-JWT VC). See notes below.
  res.json({
    format: vc.format,               // 'sd-jwt-vc' (placeholder right now)
    vc_payload: vc.vc_payload,       // current implementation
    digest: vc.digest,
    salt: vc.salt,
    anchoring: vc.anchoring,
  });
});
