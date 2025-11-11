const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const verificationSessionSchema = new mongoose.Schema(
  {
    session_id: { type: String, unique: true, required: true },
    employer: { org: String, contact: String },
    request: { types: [String], purpose: String }, // e.g., ['TOR'], 'Hiring'
    holder_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Allow meta and any future fields to persist
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: { valid: false, reason: 'pending' },
    },

    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true }, // now + 48h (or your TTL)
  },
  { versionKey: false } // strict defaults to true; Mixed bypasses strict for "result"
);

// TTL: expire exactly at expires_at
verificationSessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = vconn.model('VerificationSession', verificationSessionSchema);
