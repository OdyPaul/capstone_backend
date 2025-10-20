// backend/models/web/vcTemplate.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const AttributeSchema = new mongoose.Schema({
  key:      { type: String, required: true },
  title:    { type: String, required: true },
  type:     { type: String, enum: ["string","number","date","boolean","array","object"], default: "string" },
  required: { type: Boolean, default: false },
  path:     { type: String, default: "" },
  description: { type: String, default: "" },
}, { _id: false });

const VcTemplateSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  slug:        { type: String, required: true, unique: true },
  description: { type: String, default: "" },
  version:     { type: String, default: "1.0.0" },

  status:      { type: String, enum: ["draft"], default: "draft" },
  attributes:  { type: [AttributeSchema], default: [] },
  price:       { type: Number, default: 250 },

  // Use this to carry “Diploma” or “TOR”, etc.
  vc: {
    '@context': { type: [String], default: ["https://www.w3.org/2018/credentials/v1"] },
    type:       { type: [String], default: ["VerifiableCredential"] }
  },

  createdBy:   { type: String, default: "" },
}, { timestamps: true });

module.exports = vconn.model('VcTemplate', VcTemplateSchema);
