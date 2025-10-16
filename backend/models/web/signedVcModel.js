const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const signedVcSchema = new mongoose.Schema({
  student_id: { type: String, required: true },          // school ID for fast search
  holder_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  template_id: { type: String, required: true },         // 'TOR' | 'Diploma'
  format: { type: String, enum: ['sd-jwt-vc', 'vc+ldp'], default: 'sd-jwt-vc' },
  vc_payload: { type: Object, required: true },          // W3C VC JSON (or compact)
  digest: { type: String, required: true },              // base64url(SHA-256(...))
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
