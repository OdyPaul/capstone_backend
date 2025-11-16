// models/web/issueModel.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

function genOrderNo() {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12); // YYYYMMDDHHMM
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

/**
 * VcIssue: replaces "drafts"
 * - One open 'issued' record per (student, template, purpose).
 * - Receives a cashier's receipt_no → we sign immediately.
 */
const issueSchema = new mongoose.Schema(
  {
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'VcTemplate', required: true },
    student:  { type: mongoose.Schema.Types.ObjectId, ref: 'Student_Data', required: true },
    type:     { type: String, enum: ['tor', 'diploma'], required: true },
    purpose:  { type: String, required: true },

    // Snapshot of credentialSubject built from Student_Data + Grades (+ Curriculum)
    data:       { type: Object, default: {} },
    expiration: { type: Date, default: null },

    // Ordering + payment
    order_no:    { type: String, unique: true, default: genOrderNo },
    amount:      { type: Number, default: 250 },
    currency:    { type: String, default: 'PHP' },
    receipt_no:  { type: String, default: null, trim: true, uppercase: true },
    receipt_date:{ type: Date, default: null },
    anchorNow:   { type: Boolean, default: false },

    // Lifecycle
    status:     { type: String, enum: ['issued', 'signed', 'anchored', 'void'], default: 'issued' },
    signedAt:   { type: Date, default: null },
    anchoredAt: { type: Date, default: null },
    signedVc:   { type: mongoose.Schema.Types.ObjectId, ref: 'SignedVC', default: null },
  },
  { timestamps: true }
);

// One open issue per student/template/purpose
issueSchema.index(
  { student: 1, template: 1, purpose: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'issued' }, name: 'uniq_open_issue' }
);

// Unique receipt when present (idempotent cashier input)
issueSchema.index(
  { receipt_no: 1 },
  { unique: true, partialFilterExpression: { receipt_no: { $ne: null } }, name: 'uniq_receipt_issue' }
);

module.exports = vconn.model('VcIssue', issueSchema);
