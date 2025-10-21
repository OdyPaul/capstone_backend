// controllers/web/issueController.js
const asyncHandler = require('express-async-handler');
const UnsignedVC = require('../../models/web/vcDraft');
const SignedVC   = require('../../models/web/signedVcModel');
const { computeDigest, randomSalt } = require('../../utils/vcCrypto');
const Payment = require('../../models/web/paymentModel');
const Student = require('../../models/students/studentModel'); // ⬅️ add this

// POST /api/web/vc/drafts/:id/issue  (admin)
exports.issueFromDraft = asyncHandler(async (req, res) => {
  const draft = await UnsignedVC.findById(req.params.id)
    .populate({
      path: 'student',
      model: Student, // ⬅️ ensure correct connection/model
      select: 'fullName studentNumber program dateGraduated',
    });

  if (!draft) { res.status(404); throw new Error('Draft not found'); }
  if (!draft.student) { // ⬅️ nice, deterministic error instead of TypeError
    res.status(409);
    throw new Error('Draft has no linked student record. The student might have been deleted or not on this connection.');
  }

  // Build VC payload (minimal)
  const vcPayload = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', draft.type],
    issuer: { id: process.env.ISSUER_DID || 'did:web:example.org' },
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

  const salt   = randomSalt();
  const digest = computeDigest(vcPayload, salt);

  // Require a paid & unused payment
  const pay = await Payment.findOne({ draft: draft._id, status: 'paid', consumed_at: null });
  if (!pay) { res.status(402); throw new Error('No paid payment request found for this draft'); }

  // Create signed VC record
  const signed = await SignedVC.create({
    student_id: draft.student.studentNumber,
    template_id: draft.type,
    format: 'sd-jwt-vc',
    vc_payload: vcPayload,
    digest, salt,
    status: 'active',
    anchoring: { state: 'unanchored' }
  });

  // Consume the payment
  pay.status = 'consumed';
  pay.consumed_at = new Date();
  await pay.save();

  // Flip draft → signed (guard against double-issue)
  const upd = await UnsignedVC.updateOne(
    { _id: draft._id, status: 'draft' },
    { $set: { status: 'signed', signedAt: new Date(), signedVc: signed._id } }
  );
  if (upd.modifiedCount !== 1) {
    return res.status(409).json({ message: 'Draft is no longer in draft status' });
  }

  // Anchor now?
  const wantAnchorNow =
    String(req.query.anchorNow).toLowerCase() === 'true' ||
    pay.anchorNow === true;

  if (wantAnchorNow) {
    req.params.credId = signed._id.toString();
    const anchorCtrl = require('./anchorController');
    return anchorCtrl.mintNow(req, res);
  }

  return res.status(201).json({
    message: 'Issued (unanchored)',
    credential_id: signed._id
  });
});
