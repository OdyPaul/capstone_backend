const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

/**
 * Minimal attribute (schema field) for a VC Template.
 * - key:     identifier used in VcDraft.data (e.g., "studentId")
 * - title:   human label shown to admins ("Subject ID")
 * - type:    basic type for validation/serialization ("string"|"number"|"date"|"boolean"|"array"|"object")
 * - required:is this field required when validating a draft?
 * - path:    OPTIONAL dot-path into Student document for auto-fill (e.g. "studentNumber", "fullName", "subjects")
 */
const AttributeSchema = new mongoose.Schema({
  key:      { type: String, required: true }, // unique within template
  title:    { type: String, required: true },
  type:     { type: String, enum: ["string","number","date","boolean","array","object"], default: "string" },
  required: { type: Boolean, default: false },
  path:     { type: String, default: "" }, // Student field path for auto-fill
}, { _id: false });

const VcTemplateSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  slug:        { type: String, required: true, unique: true },
  description: { type: String, default: "" },
  version:     { type: String, default: "1.0.0" },

  // draft-only lifecycle
  status:      { type: String, enum: ["draft"], default: "draft" },

  // minimal schema fields
  attributes:  { type: [AttributeSchema], default: [] },

  // optional W3C hints (kept for future issuance; safe defaults)
  vc: {
    '@context': { type: [String], default: ["https://www.w3.org/2018/credentials/v1"] },
    type:       { type: [String], default: ["VerifiableCredential"] }
  },

  createdBy:   { type: String, default: "" },
}, { timestamps: true });

module.exports = vconn.model('VcTemplate', VcTemplateSchema);
