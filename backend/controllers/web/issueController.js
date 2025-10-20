// controllers/web/issueController.js
const asyncHandler = require('express-async-handler');
const UnsignedVC = require('../../models/web/vcDraft');
const SignedVC   = require('../../models/web/signedVcModel');
const { computeDigest, randomSalt } = require('../../utils/vcCrypto');
const Payment = require('../../models/web/paymentModel');

// POST /api/web/vc/drafts/:id/issue  (admin)
exports.issueFromDraft = asyncHandler(async (req, res) => {
  const draft = await UnsignedVC.findById(req.params.id).populate('student'); // Student_Profiles
  if (!draft) { res.status(404); throw new Error('Draft not found'); }

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

  // Flip draft → signed (guarded so we don't double-issue)
  const upd = await UnsignedVC.updateOne(
    { _id: draft._id, status: 'draft' }, // guard
    { $set: { status: 'signed', signedAt: new Date(), signedVc: signed._id } }
  );
  if (upd.modifiedCount !== 1) {
    // Someone else changed it — abort (optional: revert payment consume here if needed)
    return res.status(409).json({ message: 'Draft is no longer in draft status' });
  }

  // Anchor now?
  const wantAnchorNow =
    String(req.query.anchorNow).toLowerCase() === 'true' ||
    pay.anchorNow === true;

  if (wantAnchorNow) {
    // delegates response to mintNow
    req.params.credId = signed._id.toString();
    const anchorCtrl = require('./anchorController');
    return anchorCtrl.mintNow(req, res);
  }

  // Unanchored (queued for batch)
  return res.status(201).json({
    message: 'Issued (unanchored)',
    credential_id: signed._id
  });
});
