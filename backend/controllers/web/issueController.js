const asyncHandler = require('express-async-handler');
const UnsignedVC = require('../../models/web/vcDraft');
const SignedVC   = require('../../models/web/signedVcModel');
const { computeDigest, randomSalt } = require('../../utils/vcCrypto');

// POST /api/web/vc/drafts/:id/issue  (admin)
exports.issueFromDraft = asyncHandler(async (req, res) => {
  const draft = await UnsignedVC.findById(req.params.id)
    .populate('student'); // uses 'Student_Profiles'

  if (!draft) { res.status(404); throw new Error('Draft not found'); }

  // Build a minimal VC payload from your student + draft data
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

  // (Optional) Sign VC (JWT/LD-Proof) later; for capstone store payload
  const salt   = randomSalt();
  const digest = computeDigest(vcPayload, salt);

  const signed = await SignedVC.create({
    student_id: draft.student.studentNumber,
    template_id: draft.type,
    format: 'sd-jwt-vc',
    vc_payload: vcPayload,
    digest, salt,
    status: 'active',
    anchoring: { state: 'unanchored' }
  });

  res.status(201).json({ message: 'Issued (unanchored)', credential_id: signed._id });
});
