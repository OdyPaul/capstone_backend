// models/RulesConfig.js
const mongoose = require('mongoose');

const RulesSchema = new mongoose.Schema({
  name: { type: String, default: 'default' },
  issuer: { type: String }, // DID or issuer address (did:polygon:0x..)
  idTokens: [{ type: String }], // required claim keys to include in VC
  expirationDuration: { type: String, default: '1y' }, // e.g. '1y', '365d' or ISO date behavior
  redirect_uri: { type: String },
  client_id: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.RulesConfig || mongoose.model('RulesConfig', RulesSchema);
