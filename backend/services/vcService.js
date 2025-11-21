// services/vcService.js

const { signVcPayload } = require('../utils/signer');
const { stableStringify, digestJws, randomSalt } = require('../utils/vcCrypto');
const SignedVC = require('../models/web/signedVcModel');

/**
 * Create a VC payload (before signing).
 * Mirrors the original makeVcPayload function.
 */
function makeVcPayload({ kind, issuerDid, purpose, expiration, subjectData }) {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', kind],
    issuer: { id: issuerDid },
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      ...subjectData,
      purpose: purpose || null,
      expires: expiration || null,
    },
  };
}

/**
 * Sign a VC payload to JWS, compute digest, persist SignedVC,
 * and flip Issue → signed.
 */
async function signAndPersistVc({ issue, vcPayload }) {
  // JWS
  const jws = await signVcPayload(vcPayload);
  const salt = randomSalt();
  const digest = digestJws(jws, salt);
  const kid = process.env.ISSUER_KID || 'did:web:example.org#keys-1';

  const signed = await SignedVC.create({
    student_id: issue.student?.studentNumber,
    holder_user_id: null,
    template_id: issue.type,
    format: 'jws-vc',
    jws,
    alg: 'ES256',
    kid,
    vc_payload: JSON.parse(stableStringify(vcPayload)),
    digest,
    salt,
    status: 'active',
    anchoring: { state: 'unanchored', queue_mode: 'none' },
  });

  issue.status = 'signed';
  issue.signedAt = new Date();
  issue.signedVc = signed._id;
  await issue.save();

  return signed;
}

module.exports = {
  makeVcPayload,
  signAndPersistVc,
};
