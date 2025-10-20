// models/web/vcDraft.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const vcDraftSchema = new mongoose.Schema({
  template:   { type: mongoose.Schema.Types.ObjectId, ref: 'VcTemplate', required: true },
  student:    { type: mongoose.Schema.Types.ObjectId, ref: 'Student_Profiles', required: true },
  type:       { type: String, required: true },
  purpose:    { type: String, required: true },
  data:       { type: Object, default: {} },
  expiration: { type: Date, default: null },

  // 7-digit transaction id (server/client supplied)
  client_tx: {
    type: String,
    default: null,
    match: [/^\d{7}$/, 'client_tx must be 7 digits'],
  },

  // Draft lifecycle
  status:     { type: String, enum: ['draft', 'signed', 'anchored'], default: 'draft' },
  signedAt:   { type: Date, default: null },
  anchoredAt: { type: Date, default: null },

  payment:       { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  payment_tx_no: { type: String, default: null },
  signedVc: { type: mongoose.Schema.Types.ObjectId, ref: 'SignedVC', default: null },

}, { timestamps: true });

// unique draft per (student, template, purpose) while status='draft'
vcDraftSchema.index(
  { student: 1, template: 1, purpose: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'draft' }, name: 'uniq_draft_per_student_template_purpose' }
);

// unique client_tx when set (null allowed)
vcDraftSchema.index(
  { client_tx: 1 },
  { unique: true, partialFilterExpression: { client_tx: { $ne: null } }, name: 'uniq_client_tx' }
);

module.exports = vconn.model('VcDraft', vcDraftSchema);
