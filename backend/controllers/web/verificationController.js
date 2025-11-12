// backend/controllers/web/verificationController.js
const asyncHandler = require('express-async-handler');
const keccak256   = require('keccak256');
const crypto      = require('crypto');
const QRCode      = require('qrcode');
const mongoose    = require('mongoose');
const { importJWK, compactVerify } = require('jose');

const SignedVC = require('../../models/web/signedVcModel');
const AnchorBatch = require('../../models/web/anchorBatchModel');
const VerificationSession = require('../../models/web/verificationSessionModel');
const { digestJws, fromB64url } = require('../../utils/vcCrypto');

/* ---------- 🔔 Minimal audit (auth DB) ---------- */
const { getAuthConn, getVcConn } = require('../../config/db'); // 👈 add getVcConn
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

/* ---------- Shadow User model on vcConn (read-only) ---------- */
let VCUser = null;
function getVCUserModel() {
  try {
    if (!VCUser) {
      const vc = getVcConn && getVcConn();
      if (!vc) return null;
      VCUser = vc.models.User || vc.model('User'); // defined in userModel.js as shadow
    }
    return VCUser;
  } catch { return null; }
}

// holder name picker from VC payloads
const pickHolderName = (payloadObj) =>
  payloadObj?.credentialSubject?.fullName ||
  payloadObj?.credentialSubject?.name ||
  payloadObj?.subject?.fullName ||
  payloadObj?.subject?.name ||
  null;

// decode a JWS payload (no verify here)
function decodeJwsPayload(jws) {
  try {
    const [, b64] = String(jws).split('.');
    if (!b64) return null;
    const buf = fromB64url(b64);
    return JSON.parse(buf.toString('utf8'));
  } catch { return null; }
}
function extractPrintableFromPayload(payloadObj) {
  const cs = payloadObj?.credentialSubject || payloadObj?.subject || {};
  const mapSubj = (s = {}) => ({
    yearLevel: s.yearLevel || s.year || '',
    semester: s.semester || s.term || '',
    subjectCode: s.subjectCode || s.code || '',
    subjectDescription: s.subjectDescription || s.title || s.name || '',
    finalGrade: s.finalGrade ?? s.grade ?? '',
    units: s.units ?? s.credit ?? s.credits ?? '',
  });

  return {
    fullName: cs.fullName || cs.name || '',
    studentNumber: cs.studentNumber || cs.student_id || cs.id || '',
    address: cs.address || '',
    entranceCredentials: cs.entranceCredentials || '',
    highSchool: cs.highSchool || '',
    program: cs.program || cs.course || '',
    major: cs.major || '',
    placeOfBirth: cs.placeOfBirth || cs.birthPlace || '',
    dateAdmission: cs.dateAdmission || cs.admissionDate || '',
    dateGraduated: cs.dateGraduated || cs.graduationDate || '',
    gwa: cs.gwa || cs.GWA || '',
    subjects: Array.isArray(cs.subjects) ? cs.subjects.map(mapSubj) : [],
  };
}

/**
 * Compute vc_type and holder_name from SignedVC (payload first, then user).
 * Falls back to template_id (e.g., 'TOR', 'Diploma') when VC type array is absent.
 */
async function inferTypeAndHolderFromSigned(signed) {
  const p = signed?.vc_payload || decodeJwsPayload(signed?.jws) || null;

  // vc_type from payload.type or payload.vc.type (first element if array)
  let vcType =
    (Array.isArray(p?.vc?.type) ? p.vc.type[0] : p?.vc?.type) ??
    (Array.isArray(p?.type) ? p.type[0] : p?.type) ??
    signed?.template_id ??
    'VC';

  // holder name: payload preferred
  let holderName = pickHolderName(p);

  // If still missing, try the user doc on vcConn
  if (!holderName && signed?.holder_user_id) {
    try {
      const User = getVCUserModel();
      if (User) {
        const u = await User.findById(signed.holder_user_id).lean().select('fullName username');
        if (u) holderName = u.fullName || u.username || null;
      }
    } catch { /* ignore */ }
  }

  return { vcType, holderName };
}

/**
 * emitVerifyAudit — best-effort writer to the auth DB's AuditLog.
 */
async function emitVerifyAudit({
  event,
  actorId = null,
  actorRole = null,
  sessionId = null,
  targetCredentialId = null,
  ok = true,
  reason = null,
  title = null,
  body = null,
  extra = {},
  recipients = [],
  dedupeKey = null,
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
  if (!signed) return { ok: false, reason: 'not_found_or_revoked' };

  // derive vc_type + holder_name from vc_payload / user
  const { vcType, holderName } = await inferTypeAndHolderFromSigned(signed);

  const metaBase = {
    vc_type: vcType,
    holder_name: holderName,
    anchoring: signed.anchoring || null,
    digest: signed.digest || null,
  };

  if (signed.status !== 'active' || signed.status === 'revoked') {
    return { ok: false, reason: 'not_found_or_revoked', meta: metaBase };
  }

  if (signed.anchoring?.state !== 'anchored') {
    return {
      ok: true,
      result: {
        valid: true,
        reason: 'not_anchored',
        meta: metaBase,
      },
    };
  }

  const recomputed = digestJws(signed.jws, signed.salt);
  if (recomputed !== signed.digest) {
    return { ok: false, reason: 'digest_mismatch', meta: metaBase };
  }

  const batch = await AnchorBatch.findOne({ batch_id: signed.anchoring.batch_id }).lean();
  if (!batch || !batch.merkle_root) {
    return { ok: false, reason: 'batch_missing', meta: metaBase };
  }

  const leaf = keccak256(fromB64url(signed.digest));
  const included = verifyProof(leaf, signed.anchoring.merkle_proof || [], batch.merkle_root);
  if (!included) {
    return { ok: false, reason: 'merkle_proof_invalid', meta: metaBase };
  }

  return {
    ok: true,
    result: {
      valid: true,
      reason: 'ok',
      meta: {
        ...metaBase,
        anchoring: { ...(metaBase.anchoring || {}), merkle_root: batch.merkle_root },
      },
    },
  };
}

async function verifyStatelessPayload(payload) {
  const { jws, salt, digest, anchoring, alg, kid, jwk } = payload || {};
  if (!jws || !salt || !digest) return { ok: false, reason: 'payload_incomplete' };

  const payloadObj = decodeJwsPayload(jws);
  const vcType =
    (Array.isArray(payloadObj?.vc?.type) ? payloadObj.vc.type[0] : payloadObj?.vc?.type) ||
    (Array.isArray(payloadObj?.type) ? payloadObj.type[0] : payloadObj?.type) ||
    'VC';
  const holderName = pickHolderName(payloadObj);

  const metaBase = {
    vc_type: vcType,
    holder_name: holderName,
    anchoring: anchoring || null,
    digest,
  };

  if (alg && !['ES256'].includes(alg)) return { ok: false, reason: 'alg_not_allowed', meta: metaBase };

  const recomputed = digestJws(jws, salt);
  if (recomputed !== digest) return { ok: false, reason: 'digest_mismatch', meta: metaBase };

  const sigOK = await verifyJwsSignature(jws, jwk);
  if (!sigOK) return { ok: false, reason: 'bad_signature', meta: metaBase };

  if (anchoring?.state === 'anchored') {
    const batch = await AnchorBatch.findOne({ batch_id: anchoring.batch_id }).lean();
    if (!batch || !batch.merkle_root) return { ok: false, reason: 'batch_missing', meta: metaBase };

    const leaf = keccak256(fromB64url(digest));
    const included = verifyProof(leaf, anchoring.merkle_proof || [], batch.merkle_root);
    if (!included) return { ok: false, reason: 'merkle_proof_invalid', meta: metaBase };

    return {
      ok: true,
      result: {
        valid: true,
        reason: 'ok',
        meta: {
          ...metaBase,
          anchoring: { ...(metaBase.anchoring || {}), merkle_root: batch.merkle_root },
        },
      },
    };
  }

  return {
    ok: true,
    result: {
      valid: true,
      reason: 'not_anchored',
      meta: metaBase,
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
    credential_id,
    ui_base,
  } = req.body || {};

  const session_id = 'prs_' + crypto.randomBytes(6).toString('base64url');
  const expires_at = new Date(Date.now() + Number(ttlHours || 168) * 3600 * 1000);

  const hint_key = crypto.randomBytes(6).toString('base64url');
  const nonce = crypto.randomBytes(16).toString('base64url'); // ← per-session nonce

  await VerificationSession.create({
    session_id,
    employer: { org: org || '', contact: contact || '' },
    request: {
      types: Array.isArray(types) ? types : ['TOR'],
      purpose: 'Hiring',
      cred_hint: credential_id || null,
      hint_key,
      nonce, // store nonce in request
    },
    result: { valid: false, reason: 'pending' },
    expires_at,
  });

  const UI_BASE =
    String(
      ui_base ||
      process.env.FRONTEND_BASE_URL ||
      process.env.UI_BASE_URL ||
      process.env.BASE_URL ||
      `${req.protocol}://${req.get('host')}`
    ).replace(/\/+$/, '');

  function buildVerifyUrl(base, session, hint) {
    const hasPlaceholder = /\{session\}/.test(base);
    const url = hasPlaceholder
      ? base.replace('{session}', session)
      : base.endsWith('/verification-portal') || base.endsWith('/verify')
        ? `${base}/${session}`
        : `${base}/verify/${session}`;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}hint=${encodeURIComponent(hint)}`;
  }

  const verifyUrl = buildVerifyUrl(UI_BASE, session_id, hint_key);

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

  const safeRequest = { ...(sess.request || {}) };
  delete safeRequest.cred_hint;

  res.json({
    session_id: sess.session_id,
    employer: sess.employer,
    request: safeRequest,
    result: sess.result,
    expires_at: sess.expires_at,
  });
});

const submitPresentation = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { credential_id, payload, decision, nonce } = req.body || {};
  const now = new Date();

  const sess = await VerificationSession.findOne({ session_id: sessionId });
  if (!sess) return res.status(404).json({ message: 'Session not found' });
  if (isFinal(sess.result)) {
    return res.json({ ok: !!sess.result.valid, session: sess.session_id, result: sess.result });
  }
  if (sess.expires_at < now) {
    sess.result = { valid: false, reason: 'expired_session' };
    sess.markModified('result');
    await sess.save();

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

  if (decision === 'deny') {
    sess.result = { valid: false, reason: 'denied_by_holder' };
    sess.markModified('result');
    await sess.save();

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

  // --- Nonce check (bind presentation to this session)
  const expectedNonce = sess?.request?.nonce || null;
  if (expectedNonce) {
    if (!nonce) {
      sess.result = { valid: false, reason: 'nonce_required' };
      sess.markModified('result');
      await sess.save();
      return res.status(400).json({ ok: false, reason: 'nonce_required' });
    }
    if (String(nonce) !== String(expectedNonce)) {
      sess.result = { valid: false, reason: 'nonce_mismatch' };
      sess.markModified('result');
      await sess.save();
      return res.status(400).json({ ok: false, reason: 'nonce_mismatch' });
    }
  }

  // --- Verify VC (by id OR stateless payload)
  let outcome;
  if (credential_id && !payload) outcome = await verifyByCredentialId(credential_id);
  else if (payload && !credential_id) outcome = await verifyStatelessPayload(payload);
  else outcome = { ok: false, reason: 'bad_request' };

  if (!outcome.ok) {
    const reason = outcome.reason || 'failed';
    const meta = outcome.meta || outcome.result?.meta || undefined;
    sess.result = meta ? { valid: false, reason, meta } : { valid: false, reason };
    sess.markModified('result');
    await sess.save();

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
    return res.status(code).json({ ok: false, reason, result: sess.result });
  }

  // success
  sess.result = outcome.result;

  // --- Attach printable snapshot & signed print URL (for portal "Request printable VC")
  try {
    const { _buildSignedTorFromSessionUrl } = require('./pdfController');
    const UI_BASE = String(process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    let printable = null;

    if (payload && payload.jws) {
      const pObj = decodeJwsPayload(payload.jws) || null;
      if (pObj) printable = extractPrintableFromPayload(pObj);
    } else if (credential_id) {
      const signed = await loadSignedVCByCredentialId(credential_id);
      const pObj = signed?.vc_payload || (signed?.jws ? decodeJwsPayload(signed.jws) : null) || null;
      if (pObj) printable = extractPrintableFromPayload(pObj);
    }

    if (printable) {
      sess.result.meta = { ...(sess.result.meta || {}), printable };
      const ttl = Number(process.env.PRINT_URL_TTL_MIN || 15);
      const printUrl = _buildSignedTorFromSessionUrl({ base: UI_BASE, sessionId: sess.session_id, ttlMin: ttl });
      // keep a list for single-use enforcement in pdf controller
      if (!Array.isArray(sess.result.meta.print_tokens_used)) {
        sess.result.meta.print_tokens_used = [];
      }
      sess.result.meta.print_url = printUrl;
    }
    sess.markModified('result');
  } catch { /* non-fatal */ }

  await sess.save();

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

  // Load session to get the nonce
  const sess = await VerificationSession.findOne({ session_id: sessionId }).lean();
  if (!sess) return res.status(404).end();

  const payload = {
    t: 'vc-session',
    v: 1,
    session: sessionId,
    nonce: sess?.request?.nonce || null,   // include nonce
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
