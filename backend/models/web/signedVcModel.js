// models/web/signedVcModel.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const signedVcSchema = new mongoose.Schema({
  student_id: { type: String, required: true },
  holder_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  template_id: { type: String, required: true },

  // NEW: make space for a JWS VC
  format: { type: String, enum: ['sd-jwt-vc', 'vc+ldp', 'jws-vc'], default: 'jws-vc' },
  jws: { type: String },       // compact JWS of the VC payload
  alg: { type: String, default: 'ES256' },
  kid: { type: String, default: '' },

  // keep your original payload for convenience (optional)
  vc_payload: { type: Object, required: true },

  // digest & salt now computed from the JWS, not raw JSON
  digest: { type: String, required: true },    // base64url(SHA-256(...))
  salt: { type: String, required: true },

  status: { type: String, enum: ['active', 'revoked'], default: 'active' },
  anchoring: {
    state: { type: String, enum: ['unanchored', 'anchored'], default: 'unanchored' },
    batch_id: { type: String },
    tx_hash: { type: String },
    chain_id: { type: Number, default: 137 },
    anchored_at: { type: Date },
    merkle_proof: { type: [String], default: [] },
  },
}, { timestamps: true });

signedVcSchema.index({ student_id: 1 });
signedVcSchema.index({ 'anchoring.state': 1 });

module.exports = vconn.model('SignedVC', signedVcSchema);
