// controllers/vcController.js
const asyncHandler = require('express-async-handler');
const Student = require('../../models/web/studentModel'); // you have this already
const RulesConfig = require("../../models/web/rulesConfig");
const { buildUnsignedVC, signVC } = require('../../lib/vcBuilder');

// @route POST /api/student/:id/issue
// Issuer uses this to create & sign a credential for student id
const issueVC = asyncHandler(async (req, res) => {
  const studentId = req.params.id;
  const student = await Student.findById(studentId).lean();
  if (!student) return res.status(404).json({ message: 'Student not found' });

  // load rules config (choose default)
  let rules = await RulesConfig.findOne({ name: 'default' }).lean();
  if (!rules) {
    // fallback minimal rules
    rules = {
      issuer: process.env.METAMASK_ISSUER_ADDRESS || process.env.ISSUER_ADDRESS,
      idTokens: ['studentNumber','fullName','program','dateGraduated','gwa','honor','tor'],
      expirationDuration: '1y',
      client_id: null,
      redirect_uri: null
    };
  }

  // build unsigned credential
  const unsigned = buildUnsignedVC({ student, rules });

  // Optionally: add campus-specific fields, or embed a reference to on-chain issuance
  // e.g. unsigned.credentialStatus = { id: "...", type: "OnChainRevocationList2021" };

  // sign
  const signed = await signVC(unsigned);

  // return signed VC JSON to caller (issuer can send it to student's wallet)
  res.json(signed);
});

module.exports = {
  issueVC
};
