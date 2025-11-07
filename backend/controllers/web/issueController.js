// controllers/web/issueController.js
const asyncHandler = require('express-async-handler');
const UnsignedVC = require('../../models/web/vcDraft');
const SignedVC   = require('../../models/web/signedVcModel');
const Payment    = require('../../models/web/paymentModel');
const Student    = require('../../models/students/studentModel');
const { randomSalt, stableStringify, digestJws } = require('../../utils/vcCrypto');



// --- JWS signing helpers (jose is ESM-only) ---
let ISSUER_KEY_PROMISE = null;
async function getIssuerKey() {
  if (!ISSUER_KEY_PROMISE) {
    const { importPKCS8 } = await import('jose'); // dynamic import
    const pem = process.env.ISSUER_EC_P256_PKCS8_PEM;
    if (!pem) throw new Error('ISSUER_EC_P256_PKCS8_PEM not set');
    ISSUER_KEY_PROMISE = importPKCS8(pem, 'ES256');
  }
  return ISSUER_KEY_PROMISE;
}

async function signJws(payloadBytes, kid) {
  const { CompactSign } = await import('jose'); // dynamic import
  const key = await getIssuerKey();
  return new CompactSign(payloadBytes)
    .setProtectedHeader({ alg: 'ES256', kid })
    .sign(key);
}


function startForRange(range) {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0,0,0,0);
  switch (String(range || '').toLowerCase()) {
    case 'today': return startOfToday;
    case '1w':    return new Date(now.getTime() - 7  * 864e5);
    case '1m':    return new Date(now.getTime() - 30 * 864e5);
    case '6m':    return new Date(now.getTime() - 182 * 864e5);
    default:      return null; // All
  }
}
function escRe(s='') { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// -------------------- ISSUE FROM DRAFT --------------------
exports.issueFromDraft = asyncHandler(async (req, res) => {
  const draft = await UnsignedVC.findById(req.params.id)
    .populate({ path: 'student', model: Student, select: 'fullName studentNumber program dateGraduated' });

  if (!draft) { res.status(404); throw new Error('Draft not found'); }
  if (!draft.student) { res.status(409); throw new Error('Draft has no linked student'); }

  const issuerDid = process.env.ISSUER_DID || 'did:web:example.org';
  const kid = process.env.ISSUER_KID || `${issuerDid}#keys-1`;

  const credentialSubject = {
    ...(draft.data || {}),
    studentNumber: draft.student.studentNumber,
    fullName:      draft.student.fullName,
    program:       draft.student.program,
    dateGraduated: draft.student.dateGraduated,
    purpose:       draft.purpose || null,
    expires:       draft.expiration || null,
  };

  const vcPayload = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', draft.type],
    issuer: { id: issuerDid },
    issuanceDate: new Date().toISOString(),
    credentialSubject,
  };

  // 1) Sign the VC JSON as compact JWS (ES256)
  const payloadBytes = new TextEncoder().encode(stableStringify(vcPayload));
  const jws = await signJws(payloadBytes, kid);

  // 2) Compute digest over the signed artifact + salt
  const salt = randomSalt();
  const digest = digestJws(jws, salt);

  // 3) Require a paid & unused payment
  const pay = await Payment.findOne({ draft: draft._id, status: 'paid', consumed_at: null });
  if (!pay) { res.status(402); throw new Error('No paid payment request found for this draft'); }

  // 4) Persist Signed VC
  const signed = await SignedVC.create({
    student_id:  draft.student.studentNumber,
    template_id: draft.type,
    format:      'jws-vc',
    jws,
    alg:         'ES256',
    kid,
    vc_payload:  vcPayload,
    digest, salt,
    status: 'active',
    anchoring: { state: 'unanchored', queue_mode: 'none' }
  });

  // 5) Consume payment & flip draft → signed
  pay.status = 'consumed';
  pay.consumed_at = new Date();
  await pay.save();

  const upd = await UnsignedVC.updateOne(
    { _id: draft._id, status: 'draft' },
    { $set: { status: 'signed', signedAt: new Date(), signedVc: signed._id } }
  );
  if (upd.modifiedCount !== 1) {
    return res.status(409).json({ message: 'Draft is no longer in draft status' });
  }

  // 6) Optional request for immediate anchoring (queue only; NO mint here)
  const wantAnchorNow =
    String(req.query.anchorNow).toLowerCase() === 'true' || pay.anchorNow === true;

  if (wantAnchorNow) {
    req.params.credId = signed._id.toString();
    const anchorCtrl = require('./anchorController');
    return anchorCtrl.requestNow(req, res);
  }

   return res.status(201).json({
    message: 'Issued (unanchored)',
    credential_id: signed._id,     // mongo ObjectId (server-internal)
    key: signed.key,               // public string id (use in links/QR)
    status: signed.status,
    anchoring: signed.anchoring,
  });
});

// -------------------- LIST SIGNED --------------------
exports.listSigned = asyncHandler(async (req, res) => {
  const { q, status, anchorState, claimed, range } = req.query || {};

  const filter = {};
  const and = [];

  // exact filters
  if (status) filter.status = status;                       // 'active' | 'revoked'
  if (anchorState) filter['anchoring.state'] = anchorState; // 'unanchored' | 'queued' | 'anchored'

  // claimed filter (true|false)
  if (typeof claimed === 'string') {
    const want = claimed.toLowerCase();
    if (want === 'true')  and.push({ claimed_at: { $ne: null } });
    if (want === 'false') and.push({ $or: [{ claimed_at: { $exists: false } }, { claimed_at: null }] });
  }

  // range on createdAt
  const since = startForRange(range);
  if (since) filter.createdAt = { $gte: since };

  // text search (server-side)
  if (q) {
    const rx = new RegExp(escRe(String(q).trim()), 'i');
    and.push({
      $or: [
        { template_id: rx },
        { 'vc_payload.credentialSubject.fullName': rx },
        { 'vc_payload.credentialSubject.studentNumber': rx },
      ],
    });
  }

  if (and.length) filter.$and = and;

  const docs = await SignedVC.find(filter)
    .select('_id template_id status anchoring createdAt claimed_at vc_payload')
    .sort({ createdAt: -1 })
    .lean();

  res.json(docs);
});
