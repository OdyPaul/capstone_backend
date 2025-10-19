// models/web/vcTemplate.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

/**
 * Attribute definition for a VC Template
 */
const AttributeSchema = new mongoose.Schema({
  key:        { type: String, required: true }, // unique within template
  title:      { type: String, required: true },
  type:       { type: String, enum: ["string","number","date","boolean","array","object"], default: "string" },
  required:   { type: Boolean, default: false },
  description:{ type: String, default: "" },
  ui: {
    icon:        { type: String, default: "" },
    placeholder: { type: String, default: "" },
    group:       { type: String, default: "" },
    order:       { type: Number, default: 0 }
  },
  mapFrom: {
    model: { type: String, default: "" },  // e.g. "Student_Profiles"
    path:  { type: String, default: "" }   // e.g. "studentNumber"
  },
  enum:    { type: [String], default: undefined },
  pattern: { type: String, default: "" },
  format:  { type: String, default: "" }
}, { _id: false });

/**
 * Draft-only VC Template
 */
const VcTemplateSchema = new mongoose.Schema({
  name:        { type: String, required: true },                 // e.g. "University Transcript (TOR)"
  slug:        { type: String, required: true, unique: true },   // e.g. "tor"
  description: { type: String, default: "" },
  version:     { type: String, default: "1.0.0" },

  // Draft-only lifecycle (no publish/archive flow)
  status:      { type: String, enum: ["draft"], default: "draft" },

  // Attributes schema
  attributes:  { type: [AttributeSchema], default: [] },

  // Optional W3C VC hints when issuing
  vc: {
    '@context': { type: [String], default: ["https://www.w3.org/2018/credentials/v1"] },
    type:       { type: [String], default: ["VerifiableCredential"] }
  },

  // Audit
  createdBy:   { type: String, default: "" },
}, { timestamps: true });

module.exports = vconn.model('VcTemplate', VcTemplateSchema);
