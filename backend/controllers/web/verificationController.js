// controllers/web/verificationController.js
const asyncHandler = require('express-async-handler');
const keccak256   = require('keccak256');
const crypto      = require('crypto');
const QRCode      = require('qrcode');
const mongoose    = require('mongoose'); // 👈 keep
const { importJWK, compactVerify } = require('jose');

const SignedVC = require('../../models/web/signedVcModel');
const AnchorBatch = require('../../models/web/anchorBatchModel');
const VerificationSession = require('../../models/web/verificationSessionModel');
const { digestJws, fromB64url } = require('../../utils/vcCrypto');

/* ---------- 🔔 Minimal audit (auth DB) ---------- */
const { getAuthConn } = require('../../config/db');
const AuditLogSchema = require('../../models/common/auditLog.schema');
let AuditLogAuth = null;
function getAuditLogAuth() {
  try {
    if (!AuditLogAuth) {
      const conn = getAuthConn && getAuthConn();
      if (!conn) return null;
      AuditLogAuth = conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
    }
    return AuditLogAuth;
  } catch { return null; }
}
// helper near the top
const pickHolderName = (payloadObj) =>
  payloadObj?.credentialSubject?.fullName ||
  payloadObj?.credentialSubject?.name ||
  payloadObj?.subject?.fullName ||
  payloadObj?.subject?.name ||
  null;

// decode a JWS payload (no verify here)
function decodeJwsPayload(jws) {
  try {
    const [, b64] = String(jws).split(".");
    if (!b64) return null;
    const buf = fromB64url(b64);
    return JSON.parse(buf.toString("utf8"));
  } catch { return null; }
}

/**
 * emitVerifyAudit — best-effort writer to the auth DB's AuditLog.
 * Avoids storing sensitive payloads; uses meta for small, non-secret context.
 */
async function emitVerifyAudit({
  event,               // 'verification.session.created' | 'verification.session.begin' | 'verification.session.presented'
  actorId = null,      // if you run this behind auth, pass req.user?._id
  actorRole = null,
  sessionId = null,
  targetCredentialId = null,
  ok = true,
  reason = null,
  title = null,
  body = null,
  extra = {},
  recipients = [],
  dedupeKey = null,    // optional idempotency key
  status = 200,
  path = '',
  method = 'INTERNAL',
}) {
  try {
    const AuditLog = getAuditLogAuth();
    if (!AuditLog) return;

    if (dedupeKey) {
      const exists = await AuditLog.exists({ 'meta.dedupeKey': dedupeKey });
      if (exists) return;
    }

    await AuditLog.create({
      ts: new Date(),
      actorId: actorId || null,
      actorRole: actorRole || null,
      ip: null,
      ua: '',
      method,
      path: path || `/web/verification/${event}`,
      status,
      latencyMs: 0,
      routeTag: 'verification.activity',
      query: {},
      params: {},
      bodyKeys: [],
      draftId: null,
      paymentId: null,
      vcId: targetCredentialId || null,
      meta: {
        event,
        ok,
        reason,
        sessionId,
        recipients,
        title: title || null,
        body: body || null,
        dedupeKey: dedupeKey || undefined,
        ...extra,
      },
    });
  } catch { /* swallow — never block main flow */ }
}

/* ---------- utils ---------- */
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
  if (signed.status === 'revoked') return { ok: false, reason: 'not_found_or_revoked' };

  if (signed.anchoring?.state !== 'anchored') {
    return {
      ok: true,
      result: {
        valid: true,
        reason: 'not_anchored',
        meta: {
          vc_type: signed.type || signed.meta?.type || 'VC',
          holder_name: signed.studentFullName || signed.meta?.fullName || null,
          anchoring: signed.anchoring || null,
        },
      },
    };
  }

  const recomputed = digestJws(signed.jws, signed.salt);
  if (recomputed !== signed.digest) return { ok: false, reason: 'digest_mismatch' };

  const batch = await AnchorBatch.findOne({ batch_id: signed.anchoring.batch_id }).lean();
  if (!batch || !batch.merkle_root) return { ok: false, reason: 'batch_missing' };

  const leaf = keccak256(fromB64url(signed.digest));
  const included = verifyProof(leaf, signed.anchoring.merkle_proof || [], batch.merkle_root);
  if (!included) return { ok: false, reason: 'merkle_proof_invalid' };

  return {
    ok: true,
    result: {
      valid: true,
      reason: 'ok',
      meta: {
        vc_type: signed.type || signed.meta?.type || 'VC',
        holder_name: signed.studentFullName || signed.meta?.fullName || null,
        anchoring: {
          ...signed.anchoring,
          merkle_root: batch.merkle_root,
        },
        digest: signed.digest,
      },
    },
  };
}


async function verifyStatelessPayload(payload) {
  const { jws, salt, digest, anchoring, alg, kid, jwk } = payload || {};
  if (!jws || !salt || !digest) return { ok: false, reason: 'payload_incomplete' };
  if (alg && !['ES256'].includes(alg)) return { ok: false, reason: 'alg_not_allowed' };

  const recomputed = digestJws(jws, salt);
  if (recomputed !== digest) return { ok: false, reason: 'digest_mismatch' };

  const sigOK = await verifyJwsSignature(jws, jwk);
  if (!sigOK) return { ok: false, reason: 'bad_signature' };

  const payloadObj = decodeJwsPayload(jws);
  const vcType = (Array.isArray(payloadObj?.vc?.type) ? payloadObj.vc.type[0] : payloadObj?.vc?.type) ||
                 (Array.isArray(payloadObj?.type) ? payloadObj.type[0] : payloadObj?.type) ||
                 'VC';
  const holderName = pickHolderName(payloadObj);

  if (anchoring?.state === 'anchored') {
    const batch = await AnchorBatch.findOne({ batch_id: anchoring.batch_id }).lean();
    if (!batch || !batch.merkle_root) return { ok: false, reason: 'batch_missing' };

    const leaf = keccak256(fromB64url(digest));
    const included = verifyProof(leaf, anchoring.merkle_proof || [], batch.merkle_root);
    if (!included) return { ok: false, reason: 'merkle_proof_invalid' };

    return {
      ok: true,
      result: {
        valid: true,
        reason: 'ok',
        meta: {
          vc_type: vcType,
          holder_name: holderName,
          anchoring: { ...anchoring, merkle_root: batch.merkle_root },
          digest,
        },
      },
    };
  }

  return {
    ok: true,
    result: {
      valid: true,
      reason: 'not_anchored',
      meta: {
        vc_type: vcType,
        holder_name: holderName,
        anchoring: anchoring || null,
        digest,
      },
    },
  };
}

/* ---------- Controllers ---------- */
const createSession = asyncHandler(async (req, res) => {
  const {
    org,
    contact,
    types = ['TOR'],
    ttlHours = 168,
    credential_id,           // holder's actual id (private)
    ui_base,
  } = req.body || {};

  const session_id = 'prs_' + crypto.randomBytes(6).toString('base64url');
  const expires_at = new Date(Date.now() + Number(ttlHours || 168) * 3600 * 1000);

  // short random, not reversible to student #
  const hint_key = crypto.randomBytes(6).toString('base64url');

  await VerificationSession.create({
    session_id,
    employer: { org: org || '', contact: contact || '' },
    request: {
      types: Array.isArray(types) ? types : ['TOR'],
      purpose: 'Hiring',
      cred_hint: credential_id || null, // store privately
      hint_key,                         // opaque token for the URL
    },
    result: { valid: false, reason: 'pending' },
    expires_at,
  });

  const UI_BASE =
    String(ui_base || process.env.FRONTEND_BASE_URL || process.env.UI_BASE_URL ||
      process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

  function buildVerifyUrl(base, session, hint) {
    const hasPlaceholder = /\{session\}/.test(base);
    const url = hasPlaceholder
      ? base.replace('{session}', session)
      : base.endsWith('/verification-portal') || base.endsWith('/verify')
        ? `${base}/${session}`
        : `${base}/verify/${session}`;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}hint=${encodeURIComponent(hint)}`; // <- no credential_id in URL
  }

  const verifyUrl = buildVerifyUrl(UI_BASE, session_id, hint_key);

  // 🔔 audit: session created (idempotent per session_id)
  emitVerifyAudit({
    event: 'verification.session.created',
    sessionId: session_id,
    title: 'Verification session created',
    body: 'A verifier created a new verification session.',
    extra: {
      employer: { org: org || '', contact: contact || '' },
      types: Array.isArray(types) ? types : ['TOR'],
      expires_at,
    },
    dedupeKey: `verification.create:${session_id}`,
  }).catch(() => {});

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

  // 🔔 audit: session begun (idempotent per sessionId)
  emitVerifyAudit({
    event: 'verification.session.begin',
    sessionId,
    title: 'Verification initiated',
    body: 'The verifier began the verification session.',
    extra: {
      employer: { org: org || '', contact: contact || '' },
      purpose,
    },
    dedupeKey: `verification.begin:${sessionId}`,
  }).catch(() => {});

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

    // 🔔 audit: presented after expiry
    emitVerifyAudit({
      event: 'verification.session.presented',
      sessionId,
      ok: false,
      reason: 'expired_session',
      title: 'Presentation after expiry',
      body: 'A presentation attempt happened after the session expired.',
      extra: { method: credential_id ? 'by_id' : (payload ? 'stateless' : 'unknown') },
      dedupeKey: `verification.present:${sessionId}:expired_session`,
    }).catch(() => {});

    return res.json({ ok: false, reason: 'expired_session' });
  }

  // ✅ Holder denies
  if (decision === 'deny') {
    sess.result = { valid: false, reason: 'denied_by_holder' };
    await sess.save();

    // 🔔 audit: denied by holder
    emitVerifyAudit({
      event: 'verification.session.presented',
      sessionId,
      ok: false,
      reason: 'denied_by_holder',
      title: 'Presentation denied by holder',
      body: 'The holder denied the verification request.',
      extra: { method: 'holder_decision' },
      dedupeKey: `verification.present:${sessionId}:denied_by_holder`,
    }).catch(() => {});

    return res.json({ ok: true, session: sess.session_id, result: sess.result });
  }

  let outcome;
  if (credential_id && !payload) outcome = await verifyByCredentialId(credential_id);
  else if (payload && !credential_id) outcome = await verifyStatelessPayload(payload);
  else outcome = { ok: false, reason: 'bad_request' };

  if (!outcome.ok) {
    const reason = outcome.reason || 'failed';
    sess.result = { valid: false, reason };
    await sess.save();

    // 🔔 audit: failed verification
    emitVerifyAudit({
      event: 'verification.session.presented',
      sessionId,
      ok: false,
      reason,
      title: 'Presentation failed',
      body: `Verification failed (${reason}).`,
      extra: { method: credential_id ? 'by_id' : (payload ? 'stateless' : 'unknown') },
      dedupeKey: `verification.present:${sessionId}:${reason}`,
    }).catch(() => {});

    const code = outcome.reason === 'bad_request' ? 400 : 200;
    return res.status(code).json({ ok: false, reason });
  }

  // success (valid: true, reason: 'ok' | 'not_anchored')
  sess.result = outcome.result;
  await sess.save();

  // 🔔 audit: success
  emitVerifyAudit({
    event: 'verification.session.presented',
    sessionId,
    ok: true,
    reason: outcome.result?.reason || 'ok',
    title: 'Credential presented',
    body: outcome.result?.reason === 'not_anchored'
      ? 'Credential verified but not yet anchored.'
      : 'Credential verified successfully.',
    extra: {
      method: credential_id ? 'by_id' : 'stateless',
      valid: !!outcome.result?.valid,
    },
    dedupeKey: `verification.present:${sessionId}:${outcome.result?.reason || 'ok'}`,
  }).catch(() => {});

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
