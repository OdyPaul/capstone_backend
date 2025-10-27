// controllers/web/verificationController.js
const asyncHandler = require('express-async-handler');
const keccak256 = require('keccak256');
// const { computeDigest, fromB64url } = require('../../utils/vcCrypto');
const SignedVC = require('../../models/web/signedVcModel');
const AnchorBatch = require('../../models/web/anchorBatchModel');        // ✅ match actual filename
const VerificationSession = require('../../models/web/verificationSessionModel'); // ✅ import model
const { digestJws, fromB64url } = require('../../utils/vcCrypto');
function verifyProof(leafBuf, proof, rootHex) {
  // proof: ['0x...', '0x...'] with sortPairs=true
  let hash = leafBuf;
  for (const p of proof) {
    const sibling = Buffer.from(p.slice(2), 'hex');
    const [a, b] = [hash, sibling].sort(Buffer.compare);
    hash = keccak256(Buffer.concat([a, b]));
  }
  const computed = '0x' + hash.toString('hex');
  return computed === rootHex;
}

const createSession = asyncHandler(async (req, res) => {
  const { org, contact, types = ['TOR'], ttlHours = 48 } = req.body;
  const session_id = 'prs_' + Math.random().toString(36).slice(2, 10);
  const expires_at = new Date(Date.now() + ttlHours * 3600 * 1000);

  await VerificationSession.create({
    session_id,
    employer: { org, contact },
    request: { types, purpose: 'Hiring' },
    result: { valid: false, reason: 'pending' },
    expires_at,
  });

  res.status(201).json({
    session_id,
    verifyUrl: `${process.env.BASE_URL}/verify/${session_id}`,
  });
});

const submitPresentation = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  // Body now only needs credential_id
  const { credential_id } = req.body;

  const sess = await VerificationSession.findOne({ session_id: sessionId });
  if (!sess) { res.status(404); throw new Error('Session not found'); }
  if (sess.expires_at < new Date()) {
    sess.result = { valid: false, reason: 'expired_session' };
    await sess.save(); return res.json({ ok: false, reason: 'expired_session' });
  }

  const signed = await SignedVC.findById(credential_id).lean();
  if (!signed || signed.status !== 'active') {
    sess.result = { valid: false, reason: 'not_found_or_revoked' };
    await sess.save(); return res.json({ ok: false, reason: 'not_found_or_revoked' });
  }
  if (signed.anchoring.state !== 'anchored') {
    sess.result = { valid: false, reason: 'not_anchored' };
    await sess.save(); return res.json({ ok: false, reason: 'not_anchored' });
  }

  // Recompute digest using the SAME artifact that was anchored
  const digest = digestJws(signed.jws, signed.salt);
  if (digest !== signed.digest) {
    sess.result = { valid: false, reason: 'digest_mismatch' };
    await sess.save(); return res.json({ ok: false, reason: 'digest_mismatch' });
  }

  // Merkle inclusion
  const batch = await AnchorBatch.findOne({ batch_id: signed.anchoring.batch_id }).lean();
  if (!batch) {
    sess.result = { valid: false, reason: 'batch_missing' };
    await sess.save(); return res.json({ ok: false, reason: 'batch_missing' });
  }

  const leaf = keccak256(fromB64url(signed.digest));
  const ok = verifyProof(leaf, signed.anchoring.merkle_proof || [], batch.merkle_root);
  if (!ok) {
    sess.result = { valid: false, reason: 'merkle_proof_invalid' };
    await sess.save(); return res.json({ ok: false, reason: 'merkle_proof_invalid' });
  }

  sess.result = { valid: true };
  await sess.save();
  res.json({ ok: true, session: sess.session_id });
});

module.exports = { createSession, submitPresentation };  // ✅ explicit export
