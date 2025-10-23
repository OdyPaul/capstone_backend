// models/web/signedVcModel.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const signedVcSchema = new mongoose.Schema({
  student_id: { type: String, required: true },
  holder_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  template_id: { type: String, required: true },

  format: { type: String, enum: ['sd-jwt-vc', 'vc+ldp', 'jws-vc'], default: 'jws-vc' },
  jws: { type: String },
  alg: { type: String, default: 'ES256' },
  kid: { type: String, default: '' },

  vc_payload: { type: Object, required: true },

  digest: { type: String, required: true },    // base64url(SHA-256(...))
  salt: { type: String, required: true },

  status: { type: String, enum: ['active', 'revoked'], default: 'active' },

  anchoring: {
    // lifecycle
    state: { type: String, enum: ['unanchored', 'queued', 'anchored'], default: 'unanchored' },

    // queue / approvals
    queue_mode: { type: String, enum: ['none', 'now', 'batch'], default: 'none' },
    requested_at: { type: Date },
    requested_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    approved_mode: { type: String, enum: ['single', 'batch', null], default: null },
    approved_at: { type: Date, default: null },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // finalization
    batch_id: { type: String },
    tx_hash: { type: String },
    chain_id: { type: Number, default: 137 },
    anchored_at: { type: Date },
    merkle_proof: { type: [String], default: [] },
  },
}, { timestamps: true });

signedVcSchema.index({ student_id: 1 });
signedVcSchema.index({ 'anchoring.state': 1 });
signedVcSchema.index({ 'anchoring.queue_mode': 1 });
signedVcSchema.index({ createdAt: -1 });

module.exports = vconn.model('SignedVC', signedVcSchema);
