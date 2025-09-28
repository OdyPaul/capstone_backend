// lib/vcBuilder.js
require('dotenv').config();
const { Wallet, utils } = require('ethers');
const stableStringify = require('json-stable-stringify');

/**
 * Helper: convert expirationDuration like '1y' -> ISO date.
 * For simplicity: '1y' -> +365 days, '2y' -> 730 days, or if rules give a full ISO string use it.
 */
function computeExpiration(issuanceDateIso, expirationDuration) {
  const issued = new Date(issuanceDateIso);
  if (!expirationDuration) return null;
  if (/\d+y$/.test(expirationDuration)) {
    const years = parseInt(expirationDuration.replace('y',''), 10);
    issued.setFullYear(issued.getFullYear() + years);
    return issued.toISOString();
  }
  if (/\d+d$/.test(expirationDuration)) {
    const days = parseInt(expirationDuration.replace('d',''), 10);
    issued.setDate(issued.getDate() + days);
    return issued.toISOString();
  }
  // fallback: treat expirationDuration as ISO date
  const test = new Date(expirationDuration);
  return isNaN(test.getTime()) ? null : test.toISOString();
}

/**
 * Map Student record -> credentialSubject object according to rules.idTokens
 * - If the rule field exists on student root, copy it.
 * - If field = 'tor' we can add aggregated info or include student.subjects array
 * - You can expand mapping rules here as needed.
 */
function mapStudentToClaims(student, rules) {
  const claims = {};
  const tokens = rules.idTokens || ['studentNumber','fullName','program'];

  tokens.forEach((token) => {
    switch(token) {
      // custom tokens we want to handle explicitly
      case 'tor':
        // include subject array as TOR
        claims.tor = student.subjects || [];
        break;
      case 'gwa':
        claims.gwa = student.gwa ?? null;
        break;
      case 'honor':
        claims.honor = student.honor ?? null;
        break;
      case 'dateGraduated':
        claims.dateGraduated = student.dateGraduated ?? null;
        break;
      default:
        // generic: copy if exists on student
        if (student[token] !== undefined) claims[token] = student[token];
        else claims[token] = null;
    }
  });

  // always include id for holder DID/address if available
  if (!claims.id) {
    // if your front-end uses DID per student, replace this accordingly
    claims.id = student.did || `urn:student:${student._id}`;
  }
  return claims;
}

/**
 * Build unsigned VC object
 */
function buildUnsignedVC({student, rules}) {
  const issuanceDate = new Date().toISOString();
  const expirationDate = computeExpiration(issuanceDate, rules.expirationDuration);

  const credentialSubject = mapStudentToClaims(student, rules);

  const vc = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    id: `urn:uuid:${utils.hexlify(utils.randomBytes(16)).replace('0x','')}`,
    type: ["VerifiableCredential","UniversityCredential"],
    issuer: rules.issuer || process.env.METAMASK_ISSUER_ADDRESS || process.env.ISSUER_ADDRESS,
    issuanceDate,
    ...(expirationDate ? { expirationDate } : {}),
    credentialSubject
  };

  return vc;
}

/**
 * Sign VC using ECDSA secp256k1 with issuer private key.
 * This implementation:
 *  - canonicalizes VC JSON (stable stringify)
 *  - computes SHA-256 digest
 *  - signs digest with ethers Wallet and returns proof containing signature (jws-like hex)
 *
 * Note: this is a pragmatic approach — production systems often use a recognized proof suite (e.g.
 * EcdsaSecp256k1Signature2019 with an explicit JWS flow, or Linked Data Proofs). Adjust as needed.
 */
async function signVC(vc) {
  // canonicalize VC without proof
  const vcString = stableStringify(vc);
  const hash = utils.sha256(utils.toUtf8Bytes(vcString)); // hex string with 0x

  const issuerPriv = process.env.ISSUER_PRIVATE_KEY;
  if (!issuerPriv) throw new Error("ISSUER_PRIVATE_KEY not set in .env");

  const wallet = new Wallet(issuerPriv);

  // sign the digest directly (signDigest expects a 32 byte digest)
  const signature = wallet._signingKey().signDigest(hash);
  const joined = utils.joinSignature(signature); // 0x...
  // Build proof
  const proof = {
    type: "EcdsaSecp256k1Signature2019",
    created: new Date().toISOString(),
    proofPurpose: "assertionMethod",
    verificationMethod: `${vc.issuer}#keys-1`,
    jws: joined // hex signature (not JWS compact, but it's fine as proof field)
  };

  // attach proof
  const signed = Object.assign({}, vc, { proof });
  return signed;
}

module.exports = {
  buildUnsignedVC,
  signVC
};
