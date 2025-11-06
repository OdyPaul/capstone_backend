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
  for (const p of proof || []) {
    const sibling = hexToBuf(p);
    const [a, b] = [hash, sibling].sort(Buffer.compare);
    hash = keccak256(Buffer.concat([a, b]));
  }
  const computed = '0x' + hash.toString('hex');
  return computed.toLowerCase() === String(rootHex || '').toLowerCase();
}

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
  if (isFinal(sess.result)) return res.json({ ok: true }); // already decided

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

  // Path A: DB-stored VC
  if (credential_id && !payload) {
    const signed = await SignedVC.findById(credential_id).lean();
    if (!signed || signed.status !== 'active') {
      sess.result = { valid: false, reason: 'not_found_or_revoked' };
      await sess.save(); return res.json({ ok: false, reason: 'not_found_or_revoked' });
    }
    if (signed.anchoring?.state !== 'anchored') {
      sess.result = { valid: true, reason: 'not_anchored' }; // syntactically valid, not anchored
      await sess.save(); return res.json({ ok: true, session: sess.session_id, result: sess.result });
    }

    const digest = digestJws(signed.jws, signed.salt);
    if (digest !== signed.digest) {
      sess.result = { valid: false, reason: 'digest_mismatch' };
      await sess.save(); return res.json({ ok: false, reason: 'digest_mismatch' });
    }

    const batch = await AnchorBatch.findOne({ batch_id: signed.anchoring.batch_id }).lean();
    if (!batch || !batch.merkle_root) {
      sess.result = { valid: false, reason: 'batch_missing' };
      await sess.save(); return res.json({ ok: false, reason: 'batch_missing' });
    }

    const leaf = keccak256(fromB64url(signed.digest));
    const ok = verifyProof(leaf, signed.anchoring.merkle_proof || [], batch.merkle_root);
    if (!ok) {
      sess.result = { valid: false, reason: 'merkle_proof_invalid' };
      await sess.save(); return res.json({ ok: false, reason: 'merkle_proof_invalid' });
    }

    sess.result = { valid: true, reason: 'ok' };
    await sess.save();
    return res.json({ ok: true, session: sess.session_id, result: sess.result });
  }

  // Path B: stateless payload from phone
  if (payload && !credential_id) {
    const { jws, salt, digest, anchoring, alg } = payload;

    if (!jws || !salt || !digest) {
      sess.result = { valid: false, reason: 'payload_incomplete' };
      await sess.save(); return res.json({ ok: false, reason: 'payload_incomplete' });
    }

    // optional: enforce allowed alg
    if (alg && !['ES256'].includes(alg)) {
      sess.result = { valid: false, reason: 'alg_not_allowed' };
      await sess.save(); return res.json({ ok: false, reason: 'alg_not_allowed' });
    }

    const recomputed = digestJws(jws, salt);
    if (recomputed !== digest) {
      sess.result = { valid: false, reason: 'digest_mismatch' };
      await sess.save(); return res.json({ ok: false, reason: 'digest_mismatch' });
    }

    if (anchoring?.state === 'anchored') {
      const batch = await AnchorBatch.findOne({ batch_id: anchoring.batch_id }).lean();
      if (!batch || !batch.merkle_root) {
        sess.result = { valid: false, reason: 'batch_missing' };
        await sess.save(); return res.json({ ok: false, reason: 'batch_missing' });
      }
      const leaf = keccak256(fromB64url(digest));
      const ok = verifyProof(leaf, anchoring.merkle_proof || [], batch.merkle_root);
      if (!ok) {
        sess.result = { valid: false, reason: 'merkle_proof_invalid' };
        await sess.save(); return res.json({ ok: false, reason: 'merkle_proof_invalid' });
      }
      sess.result = { valid: true, reason: 'ok' };
    } else {
      sess.result = { valid: true, reason: 'not_anchored' };
    }

    await sess.save();
    return res.json({ ok: true, session: sess.session_id, result: sess.result });
  }

  sess.result = { valid: false, reason: 'bad_request' };
  await sess.save();
  return res.status(400).json({ ok: false, reason: 'bad_request' });
});

module.exports = { createSession, beginSession, getSession, submitPresentation };
