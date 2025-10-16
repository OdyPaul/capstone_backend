const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();
const vcTemplateSchema = new mongoose.Schema({
  _id: { type: String, required: true },       // e.g. 'TOR', 'Diploma'
  displayName: { type: String, required: true },
  schema: { type: Object, default: {} },       // optional structure
  version: { type: String, default: '1.0' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = vconn.model('VCTemplate', vcTemplateSchema);
