// controllers/web/issueController.js
const asyncHandler = require('express-async-handler');
const UnsignedVC = require('../../models/web/vcDraft');
const SignedVC = require('../../models/web/signedVcModel');
const Payment = require('../../models/web/paymentModel');
const Student = require('../../models/students/studentModel');
const { randomSalt, stableStringify } = require('../../utils/vcCrypto');
const crypto = require('crypto');

const sha256b64url = (s) =>
  crypto.createHash('sha256').update(s).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// If you’re on Node < 18, uncomment this:
// const { TextEncoder } = require('util');

let ISSUER_KEY_PROMISE = null;
async function getIssuerKey() {
  if (!ISSUER_KEY_PROMISE) {
    const { importPKCS8 } = await import('jose'); // ESM-only lib
    const pem = process.env.ISSUER_EC_P256_PKCS8_PEM;
    if (!pem) throw new Error('ISSUER_EC_P256_PKCS8_PEM not set');
    ISSUER_KEY_PROMISE = importPKCS8(pem, 'ES256');
  }
  return ISSUER_KEY_PROMISE;
}

async function signJws(payloadBytes, kid) {
  const { CompactSign } = await import('jose'); // ESM-only lib
  const key = await getIssuerKey();
  return new CompactSign(payloadBytes)
    .setProtectedHeader({ alg: 'ES256', kid })
    .sign(key);
}

exports.issueFromDraft = asyncHandler(async (req, res) => {
  const draft = await UnsignedVC.findById(req.params.id)
    .populate({ path: 'student', model: Student, select: 'fullName studentNumber program dateGraduated' });

  if (!draft) { res.status(404); throw new Error('Draft not found'); }
  if (!draft.student) { res.status(409); throw new Error('Draft has no linked student'); }

  const issuerDid = process.env.ISSUER_DID || 'did:web:example.org';
  const kid = process.env.ISSUER_KID || `${issuerDid}#keys-1`;

  const vcPayload = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', draft.type],
    issuer: { id: issuerDid },
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      studentNumber: draft.student.studentNumber,
      fullName:      draft.student.fullName,
      program:       draft.student.program,
      dateGraduated: draft.student.dateGraduated,
      purpose:       draft.purpose || null,
      expires:       draft.expiration || null,
    }
  };

  // 1) Sign VC → compact JWS (helper handles CompactSign + header + sign)
  const payloadBytes = new TextEncoder().encode(stableStringify(vcPayload));
  const jws = await signJws(payloadBytes, kid);

  // 2) Digest over signed artifact + salt
  const salt = randomSalt();
  const digest = sha256b64url(`${jws}.${salt}`);

  // 3) Require paid & unused payment
  const pay = await Payment.findOne({ draft: draft._id, status: 'paid', consumed_at: null });
  if (!pay) { res.status(402); throw new Error('No paid payment request found for this draft'); }

  // 4) Save SignedVC
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
    anchoring: { state: 'unanchored' }
  });

  // 5) Consume payment & flip draft
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

  // 6) Anchor now?
  const wantAnchorNow =
    String(req.query.anchorNow).toLowerCase() === 'true' || pay.anchorNow === true;

  if (wantAnchorNow) {
    req.params.credId = signed._id.toString();
    const anchorCtrl = require('./anchorController');
    return anchorCtrl.mintNow(req, res);
  }

  return res.status(201).json({ message: 'Issued (unanchored)', credential_id: signed._id });
});
