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

  // Draft lifecycle
  status:     { type: String, enum: ["draft", "signed", "anchored"], default: "draft" },
  signedAt:   { type: Date, default: null },
  anchoredAt: { type: Date, default: null },
}, { timestamps: true });

// Only one ACTIVE draft per (student, template, purpose)
vcDraftSchema.index(
  { student: 1, template: 1, purpose: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "draft" },
    name: "uniq_draft_per_student_template_purpose"
  }
);

module.exports = vconn.model('VcDraft', vcDraftSchema);
