// controllers/web/verificationController.js
const asyncHandler = require('express-async-handler');
const keccak256 = require('keccak256');
const crypto = require('crypto');

const SignedVC = require('../../models/web/signedVcModel');
const AnchorBatch = require('../../models/web/anchorBatchModel');
const VerificationSession = require('../../models/web/verificationSessionModel');
const { digestJws, fromB64url } = require('../../utils/vcCrypto');

const hexToBuf = (h) => Buffer.from(String(h || '').replace(/^0x/i, ''), 'hex');
const isFinal = (r) => r && r.reason && r.reason !== 'pending';

function verifyProof(leafBuf, proof, rootHex) {
  let hash = leafBuf;
  for (const p of (proof || [])) {
    const sibling = hexToBuf(p);
    const [a, b] = [hash, sibling].sort(Buffer.compare);
    hash = keccak256(Buffer.concat([a, b]));
  }
  const computed = '0x' + hash.toString('hex');
  return computed.toLowerCase() === String(rootHex || '').toLowerCase();
}

/* ---------------- core verifiers ---------------- */
async function verifyByCredentialId(credential_id) {
  const signed = await SignedVC.findById(credential_id).lean();
  if (!signed || signed.status !== 'active') return { ok: false, reason: 'not_found_or_revoked' };

  if (signed.anchoring?.state !== 'anchored') {
    // syntactically valid but not anchored
    return { ok: true, result: { valid: true, reason: 'not_anchored' } };
  }

  const recomputed = digestJws(signed.jws, signed.salt);
  if (recomputed !== signed.digest) return { ok: false, reason: 'digest_mismatch' };

  const batch = await AnchorBatch.findOne({ batch_id: signed.anchoring.batch_id }).lean();
  if (!batch || !batch.merkle_root) return { ok: false, reason: 'batch_missing' };

  const leaf = keccak256(fromB64url(signed.digest));
  const included = verifyProof(leaf, signed.anchoring.merkle_proof || [], batch.merkle_root);
  if (!included) return { ok: false, reason: 'merkle_proof_invalid' };

  return { ok: true, result: { valid: true, reason: 'ok' } };
}

async function verifyStatelessPayload(payload) {
  const { jws, salt, digest, anchoring, alg } = payload || {};
  if (!jws || !salt || !digest) return { ok: false, reason: 'payload_incomplete' };
  if (alg && !['ES256'].includes(alg)) return { ok: false, reason: 'alg_not_allowed' };

  const recomputed = digestJws(jws, salt);
  if (recomputed !== digest) return { ok: false, reason: 'digest_mismatch' };

  if (anchoring?.state === 'anchored') {
    const batch = await AnchorBatch.findOne({ batch_id: anchoring.batch_id }).lean();
    if (!batch || !batch.merkle_root) return { ok: false, reason: 'batch_missing' };
    const leaf = keccak256(fromB64url(digest));
    const included = verifyProof(leaf, anchoring.merkle_proof || [], batch.merkle_root);
    if (!included) return { ok: false, reason: 'merkle_proof_invalid' };
    return { ok: true, result: { valid: true, reason: 'ok' } };
  }

  return { ok: true, result: { valid: true, reason: 'not_anchored' } };
}

/* ---------------- controllers ---------------- */
const createSession = asyncHandler(async (req, res) => {
  const { org, contact, types = ['TOR'], ttlHours = 48 } = req.body || {};
  const session_id = 'prs_' + crypto.randomBytes(6).toString('base64url');
  const expires_at = new Date(Date.now() + Number(ttlHours || 48) * 3600 * 1000);

  await VerificationSession.create({
    session_id,
    employer: { org: org || '', contact: contact || '' },
    request: { types: Array.isArray(types) ? types : ['TOR'], purpose: 'Hiring' },
    result: { valid: false, reason: 'pending' },
    expires_at,
  });

  res.status(201).json({
    session_id,
    verifyUrl: `${process.env.BASE_URL}/verify/${session_id}`,
  });
});

const beginSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { org, contact, purpose = 'General verification' } = req.body || {};
  const sess = await VerificationSession.findOne({ session_id: sessionId });
  if (!sess) return res.status(404).json({ message: 'Session not found' });
  if (sess.expires_at < new Date()) return res.status(410).json({ message: 'Session expired' });
  if (isFinal(sess.result)) return res.json({ ok: true });

  sess.employer = { org: org || '', contact: contact || '' };
  sess.request = { ...(sess.request || {}), purpose };
  sess.markModified('employer');
  sess.markModified('request');
  await sess.save();

  res.json({ ok: true });
});

const getSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const sess = await VerificationSession.findOne({ session_id: sessionId }).lean();
  if (!sess) return res.status(404).json({ message: 'Session not found' });

  res.set('Cache-Control', 'no-store');
  res.json({
    session_id: sess.session_id,
    employer: sess.employer,
    request: sess.request,
    result: sess.result,
    expires_at: sess.expires_at,
  });
});

const submitPresentation = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { credential_id, payload } = req.body || {};
  const now = new Date();

  const sess = await VerificationSession.findOne({ session_id: sessionId });
  if (!sess) return res.status(404).json({ message: 'Session not found' });
  if (isFinal(sess.result)) return res.json({ ok: !!sess.result.valid, session: sess.session_id, result: sess.result });
  if (sess.expires_at < now) {
    sess.result = { valid: false, reason: 'expired_session' };
    await sess.save();
    return res.json({ ok: false, reason: 'expired_session' });
  }

  let outcome;
  if (credential_id && !payload) outcome = await verifyByCredentialId(credential_id);
  else if (payload && !credential_id) outcome = await verifyStatelessPayload(payload);
  else outcome = { ok: false, reason: 'bad_request' };

  if (!outcome.ok) {
    sess.result = { valid: false, reason: outcome.reason || 'failed' };
    await sess.save();
    const code = outcome.reason === 'bad_request' ? 400 : 200;
    return res.status(code).json({ ok: false, reason: sess.result.reason });
  }

  sess.result = outcome.result;
  await sess.save();
  return res.json({ ok: true, session: sess.session_id, result: sess.result });
});

module.exports = {
  createSession,
  beginSession,
  getSession,
  submitPresentation,
};
