// controllers/web/verificationController.js
const asyncHandler = require('express-async-handler');
const keccak256 = require('keccak256');
const crypto = require('crypto');
const Jimp = require('jimp');
import jsQR from 'jsqr';

const SignedVC = require('../../models/web/signedVcModel');
const AnchorBatch = require('../../models/web/anchorBatchModel');
const VerificationSession = require('../../models/web/verificationSessionModel');
const ClaimTicket = require('../../models/web/claimTicket'); // to resolve /c/:token
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

const buildVcPayload = (vc) => ({
  format: 'vc+jws',
  jws: vc.jws,
  kid: vc.kid,
  alg: vc.alg,
  salt: vc.salt,
  digest: vc.digest,
  anchoring: vc.anchoring,
});

/* ---------- core verifiers ---------- */
async function verifyByCredentialId(credential_id) {
  const signed = await SignedVC.findById(credential_id).lean();
  if (!signed || signed.status !== 'active') return { ok: false, reason: 'not_found_or_revoked' };

  if (signed.anchoring?.state !== 'anchored') {
    // syntactically valid but not anchored
    return { ok: true, result: { valid: true, reason: 'not_anchored' } };
  }

  const digest = digestJws(signed.jws, signed.salt);
  if (digest !== signed.digest) return { ok: false, reason: 'digest_mismatch' };

  const batch = await AnchorBatch.findOne({ batch_id: signed.anchoring.batch_id }).lean();
  if (!batch || !batch.merkle_root) return { ok: false, reason: 'batch_missing' };

  const leaf = keccak256(fromB64url(signed.digest));
  const ok = verifyProof(leaf, signed.anchoring.merkle_proof || [], batch.merkle_root);
  if (!ok) return { ok: false, reason: 'merkle_proof_invalid' };

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
    const ok = verifyProof(leaf, anchoring.merkle_proof || [], batch.merkle_root);
    if (!ok) return { ok: false, reason: 'merkle_proof_invalid' };
    return { ok: true, result: { valid: true, reason: 'ok' } };
  }
  return { ok: true, result: { valid: true, reason: 'not_anchored' } };
}

/* ---------- QR decoding ---------- */
async function decodeQrBuffer(buf) {
  const image = await Jimp.read(buf);
  return new Promise((resolve, reject) => {
    const qr = new QrCode();
    qr.callback = (err, v) => (err ? reject(err) : resolve((v && v.result) || ''));
    qr.decode(image.bitmap);
  });
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function extractClaimTokenFromUrl(text) {
  try {
    const u = new URL(text);
    const m = u.pathname.match(/\/c\/([^/]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

/* ---------- public handlers ---------- */
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
  sess.markModified('employer'); sess.markModified('request');
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

  if (credential_id && !payload) {
    outcome = await verifyByCredentialId(credential_id);
  } else if (payload && !credential_id) {
    outcome = await verifyStatelessPayload(payload);
  } else {
    outcome = { ok: false, reason: 'bad_request' };
  }

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

/* ---------- NEW: upload QR image to verify without scanning ---------- */
const presentFromQrImage = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const sess = await VerificationSession.findOne({ session_id: sessionId });
  if (!sess) return res.status(404).json({ message: 'Session not found' });
  if (isFinal(sess.result)) return res.json({ ok: !!sess.result.valid, session: sess.session_id, result: sess.result });
  if (sess.expires_at < new Date()) {
    sess.result = { valid: false, reason: 'expired_session' };
    await sess.save();
    return res.json({ ok: false, reason: 'expired_session' });
  }

  // Accept either file field 'qr' or a base64 data URL in body.imageDataUrl
  let buf = null;
  if (req.file && req.file.buffer) {
    buf = req.file.buffer;
  } else if (req.body && typeof req.body.imageDataUrl === 'string') {
    const m = req.body.imageDataUrl.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
    if (m) buf = Buffer.from(m[1], 'base64');
  }
  if (!buf) return res.status(400).json({ ok: false, reason: 'no_image' });

  let text = '';
  try {
    text = await decodeQrBuffer(buf);
  } catch {
    return res.status(422).json({ ok: false, reason: 'qr_decode_failed' });
  }

  // Accept either: claim URL (/c/:token), or raw JSON payload
  let payload = null;

  // 1) Try claim URL
  const token = extractClaimTokenFromUrl(text);
  if (token) {
    const now = new Date();
    const t = await ClaimTicket.findOne({ token });
    if (!t) return res.status(404).json({ ok: false, reason: 'claim_not_found' });
    if (t.expires_at && t.expires_at < now) return res.status(410).json({ ok: false, reason: 'claim_expired' });

    const vc = await SignedVC.findById(t.cred_id)
      .select('_id jws alg kid digest salt anchoring status').lean();
    if (!vc) return res.status(404).json({ ok: false, reason: 'credential_not_found' });
    if (vc.status !== 'active') return res.status(409).json({ ok: false, reason: 'credential_not_active' });

    // (Optionally mark ticket used here, mirroring redeemClaim)
    if (!t.used_at) { t.used_at = now; await t.save().catch(() => {}); }

    payload = buildVcPayload(vc);
  }

  // 2) Try JSON payload inside QR (stateless)
  if (!payload) {
    const parsed = tryParseJson(text);
    if (parsed && parsed.jws && parsed.salt && parsed.digest) {
      payload = parsed;
    }
  }

  if (!payload) return res.status(400).json({ ok: false, reason: 'qr_unrecognized' });

  // Reuse the same stateless verification
  const outcome = await verifyStatelessPayload(payload);
  if (!outcome.ok) {
    sess.result = { valid: false, reason: outcome.reason || 'failed' };
    await sess.save();
    return res.json({ ok: false, reason: sess.result.reason });
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
  presentFromQrImage, // NEW
};
