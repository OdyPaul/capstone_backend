// models/web/signedVcModel.js
const mongoose = require('mongoose');
const crypto = require('crypto');            // 👈 add this
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const signedVcSchema = new mongoose.Schema({
  // Public, stable id you can share with clients (e.g., "web_AbC123…")
  key: { type: String, unique: true, sparse: true, index: true },

  student_id: { type: String, required: true },
  holder_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  template_id: { type: String, required: true },

  format: { type: String, enum: ['sd-jwt-vc', 'vc+ldp', 'jws-vc'], default: 'jws-vc' },
  jws: { type: String },
  alg: { type: String, default: 'ES256' },
  kid: { type: String, default: '' },

  vc_payload: { type: Object, required: true },

  digest: { type: String, required: true }, // base64url(SHA-256(...))
  salt: { type: String, required: true },

  status: { type: String, enum: ['active', 'revoked'], default: 'active' },

  anchoring: {
    state: { type: String, enum: ['unanchored', 'queued', 'anchored'], default: 'unanchored' },
    queue_mode: { type: String, enum: ['none', 'now', 'batch'], default: 'none' },
    requested_at: { type: Date },
    requested_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approved_mode: { type: String, enum: ['single', 'batch', null], default: null },
    approved_at: { type: Date, default: null },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    batch_id: { type: String },
    tx_hash: { type: String },
    chain_id: { type: Number, default: 137 },
    anchored_at: { type: Date },
    merkle_proof: { type: [String], default: [] },
  },

  claimed_at: { type: Date, default: null, index: true },
}, { timestamps: true });

signedVcSchema.index({ student_id: 1 });
signedVcSchema.index({ 'anchoring.state': 1 });
signedVcSchema.index({ 'anchoring.queue_mode': 1 });
signedVcSchema.index({ createdAt: -1 });

// Generate a unique, URL-safe key like "web_xxxxxxx"
async function genUniqueKey(Model, prefix = 'web') {
  for (let i = 0; i < 8; i++) {
    const cand = `${prefix}_${crypto.randomBytes(7).toString('base64url')}`;
    const exists = await Model.exists({ key: cand });
    if (!exists) return cand;
  }
  throw new Error('Failed to generate unique SignedVC.key');
}

signedVcSchema.pre('save', async function(next) {
  if (this.key) return next();
  try {
    this.key = await genUniqueKey(this.constructor, 'web');
    next();
  } catch (e) {
    next(e);
  }
});

module.exports = vconn.model('SignedVC', signedVcSchema);
