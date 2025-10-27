const crypto = require('crypto');

function sortObjDeep(v) {
  if (Array.isArray(v)) return v.map(sortObjDeep);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    Object.keys(v).sort().forEach(k => { out[k] = sortObjDeep(v[k]); });
    return out;
  }
  return v;
}

function stableStringify(value) {
  return JSON.stringify(sortObjDeep(value));
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const pad = str.length % 4 === 2 ? '==' : str.length % 4 === 3 ? '=' : '';
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sha256Base64Url(input) {
  const hash = crypto.createHash('sha256').update(input).digest();
  return b64url(hash);
}

function digestJws(jws, salt) {
  return sha256Base64Url(`${jws}.${salt}`);
}

function randomSalt() { return b64url(crypto.randomBytes(16)); }

// Legacy (payload+salt) – keep exported in case other code still uses it.
function computeDigest(vcPayload, salt) {
  const s = stableStringify(vcPayload);
  return sha256Base64Url(`${s}.${salt}`);
}

module.exports = { stableStringify, computeDigest, randomSalt, fromB64url, digestJws };
