// controllers/web/verificationController.js
const asyncHandler = require('express-async-handler');
const keccak256   = require('keccak256');
const crypto      = require('crypto');
const QRCode      = require('qrcode');
const mongoose    = require('mongoose'); // 👈 add this
const { importJWK, compactVerify } = require('jose');

const SignedVC = require('../../models/web/signedVcModel');
const AnchorBatch = require('../../models/web/anchorBatchModel');
const VerificationSession = require('../../models/web/verificationSessionModel');
const { digestJws, fromB64url } = require('../../utils/vcCrypto');

const hexToBuf = (h) => Buffer.from(String(h || '').replace(/^0x/i, ''), 'hex');
const isFinal = (r) => r && r.reason && r.reason !== 'pending';

/* ---------- Merkle proof helper ---------- */
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

/* ---------- OPTIONAL: JWS signature verify (stateless) ---------- */
async function verifyJwsSignature(jws, maybeJwk) {
  if (!maybeJwk) return true; // skip if you don’t provide a JWK (digest/Merkle-only trust)
  const key = await importJWK(maybeJwk, 'ES256');
  try {
    await compactVerify(jws, key);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Helper: load VC by ObjectId OR by string key ---------- */
async function loadSignedVCByCredentialId(credential_id) {
  if (!credential_id) return null;

  if (mongoose.isValidObjectId(credential_id)) {
    const byId = await SignedVC.findById(credential_id).lean();
    if (byId) return byId;
  }

  const asString = String(credential_id);
  const byKey = await SignedVC.findOne({ key: asString }).lean();
  if (byKey) return byKey;

  const byStudent = await SignedVC.findOne({ student_id: asString }).lean();
  if (byStudent) return byStudent;

  // Optional: string _id docs
  try {
    const byStringId = await SignedVC.findOne({ _id: asString }).lean();
    if (byStringId) return byStringId;
  } catch {}

  return null;
}


/* ---------- Core verifiers ---------- */
async function verifyByCredentialId(credential_id) {
  const signed = await loadSignedVCByCredentialId(credential_id);
  if (!signed || signed.status !== 'active') return { ok: false, reason: 'not_found_or_revoked' };
  // 👉 Only reject when explicitly revoked
  if (signed.status === 'revoked') return { ok: false, reason: 'not_found_or_revoked' };

  if (signed.anchoring?.state !== 'anchored') {
    // Valid VC, not anchored yet
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
  const { jws, salt, digest, anchoring, alg, kid, jwk } = payload || {};
  if (!jws || !salt || !digest) return { ok: false, reason: 'payload_incomplete' };
  if (alg && !['ES256'].includes(alg)) return { ok: false, reason: 'alg_not_allowed' };

  const recomputed = digestJws(jws, salt);
  if (recomputed !== digest) return { ok: false, reason: 'digest_mismatch' };

  const sigOK = await verifyJwsSignature(jws, jwk);
  if (!sigOK) return { ok: false, reason: 'bad_signature' };

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

/* ---------- Controllers ---------- */
// controllers/web/verificationController.js
const createSession = asyncHandler(async (req, res) => {
  const {
    org,
    contact,
    types = ['TOR'],
    ttlHours = 168,
    credential_id,     // ← provided by client (optional)
    ui_base,
  } = req.body || {};

  const session_id = 'prs_' + crypto.randomBytes(6).toString('base64url');
  const expires_at = new Date(Date.now() + Number(ttlHours || 168) * 3600 * 1000);

  await VerificationSession.create({
    session_id,
    employer: { org: org || '', contact: contact || '' },
    // ⬇️ persist credential_id here so mobile can read it later
    request: { types: Array.isArray(types) ? types : ['TOR'], purpose: 'Hiring', credential_id: credential_id || '' },
    result: { valid: false, reason: 'pending' },
    expires_at,
  });

  const UI_BASE = String(
    ui_base || process.env.FRONTEND_BASE_URL || process.env.UI_BASE_URL || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`
  ).replace(/\/+$/, '');

  function buildVerifyUrl(base, session, credId) {
    const hasPlaceholder = /\{session\}/.test(base);
    const url = hasPlaceholder
      ? base.replace('{session}', session)
      : base.endsWith('/verification-portal') || base.endsWith('/verify')
        ? `${base}/${session}`
        : `${base}/verify/${session}`;
    const sep = url.includes('?') ? '&' : '?';
    return credId ? `${url}${sep}credential_id=${encodeURIComponent(String(credId))}` : url;
  }

  const verifyUrl = buildVerifyUrl(UI_BASE, session_id, credential_id);

  res.status(201).json({ session_id, verifyUrl, expires_at });
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

// controllers/web/verificationController.js
const submitPresentation = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  // ⬇️ add decision here
  const { credential_id, payload, decision } = req.body || {};
  const now = new Date();

  const sess = await VerificationSession.findOne({ session_id: sessionId });
  if (!sess) return res.status(404).json({ message: 'Session not found' });
  if (isFinal(sess.result)) {
    return res.json({ ok: !!sess.result.valid, session: sess.session_id, result: sess.result });
  }
  if (sess.expires_at < now) {
    sess.result = { valid: false, reason: 'expired_session' };
    await sess.save();
    return res.json({ ok: false, reason: 'expired_session' });
  }

  // ✅ Deny path (works now)
  if (decision === 'deny') {
    sess.result = { valid: false, reason: 'denied_by_holder' };
    await sess.save();
    return res.json({ ok: true, session: sess.session_id, result: sess.result });
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


/* ---------- Session QR image (for mobile wallet to read) ---------- */
const sessionQrPng = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const size = Math.min(Number(req.query.size) || 220, 800);

  const payload = {
    t: 'vc-session',
    v: 1,
    session: sessionId,
    api: (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '') + '/api',
    ts: Date.now(),
  };

  const text = JSON.stringify(payload);
  const png = await QRCode.toBuffer(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(png);
});

module.exports = {
  createSession,
  beginSession,
  getSession,
  submitPresentation,
  sessionQrPng,
};
