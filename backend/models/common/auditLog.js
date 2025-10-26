const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const AuditLogSchema = new mongoose.Schema({
  ts:         { type: Date, default: Date.now, index: true },
  // who/what
  actorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorRole:  { type: String, enum: ['student','staff','admin','developer', null], default: null },
  ip:         { type: String, default: '' },
  ua:         { type: String, default: '' },

  // request
  method:     { type: String, default: '' },
  path:       { type: String, index: true },
  status:     { type: Number, default: 0 },
  latencyMs:  { type: Number, default: 0 },

  // context
  routeTag:   { type: String, default: '' }, // e.g. "auth.login", "vc.requestNow"
  query:      { type: Object, default: {} },
  params:     { type: Object, default: {} },
  bodyKeys:   { type: [String], default: [] }, // never store raw passwords/tokens

  // business identifiers (optional quick filters)
  draftId:    { type: String, default: null },
  paymentId:  { type: String, default: null },
  vcId:       { type: String, default: null },

  // arbitrary extra data (small!)
  meta:       { type: Object, default: {} },
}, { versionKey: false });

AuditLogSchema.index({ path: 1, ts: -1 });
AuditLogSchema.index({ actorId: 1, ts: -1 });

module.exports = vconn.model('AuditLog', AuditLogSchema);
