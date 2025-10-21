// utils/tokens.js
const crypto = require('crypto');
exports.randomToken = () => crypto.randomBytes(24).toString('base64url'); // ~192 bits
