const fs = require('fs');

// Cache the imported key between calls
let KEY_PROMISE;

async function getIssuerKey() {
  if (!KEY_PROMISE) {
    const { importPKCS8 } = await import('jose');
    const pem =
      process.env.ISSUER_EC_P256_PKCS8_PEM ||
      fs.readFileSync('./issuer-priv-pkcs8.pem', 'utf8'); // fallback to local file for dev
    KEY_PROMISE = importPKCS8(pem, 'ES256');
  }
  return KEY_PROMISE;
}

async function signVcPayload(vcPayload) {
  const { CompactSign } = await import('jose');
  const kid = process.env.ISSUER_KID || 'did:web:example.org#keys-1';
  const payloadBytes = new TextEncoder().encode(JSON.stringify(vcPayload));
  const key = await getIssuerKey();
  return new CompactSign(payloadBytes).setProtectedHeader({ alg: 'ES256', kid }).sign(key);
}

module.exports = { signVcPayload };
