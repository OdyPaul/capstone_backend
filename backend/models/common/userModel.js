// models/common/userModel.js
const mongoose = require('mongoose');
const { getAuthConn, getVcConn } = require('../../config/db');
const readonlyPlugin = require('../_plugins/readonly');

// ---------------- Base (shared) fields ----------------
const baseSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },

  role:     { type: String, enum: ['student','admin','superadmin','developer'], default: 'student' },

  did:      { type: String, unique: true, sparse: true },
  verified: { type: String, enum: ['unverified','verified'], default: 'unverified' },

  // 👇 moved here so both web & mobile can persist it
  profilePicture: { type: String, default: null },
}, {
  timestamps: true,
  discriminatorKey: 'kind',
  collection: 'users',
  toJSON: {
    virtuals: true,
    transform: (_doc, ret) => { delete ret.password; delete ret.__v; return ret; }
  }
});

// Guard for kind ↔ role consistency
baseSchema.pre('validate', function(next) {
  if (this.kind === 'mobile' && this.role !== 'student') {
    return next(new Error('Mobile users must have role=student'));
  }
  if (this.kind === 'web' && !['admin','superadmin','developer'].includes(this.role)) {
    return next(new Error('Web users must be admin/superadmin/developer'));
  }
  next();
});

// Canonical model
const AuthUser = getAuthConn().model('User', baseSchema);

// Discriminators
const MobileUser = AuthUser.discriminator('mobile', new mongoose.Schema({}, { _id: false }));

const WebUser = AuthUser.discriminator(
  'web',
  new mongoose.Schema({
    fullName:  { type: String, trim: true },
    age:       { type: Number, min: 0, max: 150 },
    address:   { type: String, trim: true },
    gender:    { type: String, enum: ['male','female','other'], default: 'other' },
    contactNo: { type: String, trim: true },
    // ❌ profilePicture removed here (now on base)
  }, { _id: false })
);

// Read-only shadow on vcConn
const shadowSchemaVC = baseSchema.clone();
shadowSchemaVC.plugin(readonlyPlugin, { modelName: 'User (shadow on vcConn)' });
const vcConn = getVcConn();
try { vcConn.model('User'); } catch { vcConn.model('User', shadowSchemaVC); }

module.exports = AuthUser;
module.exports.MobileUser = MobileUser;
module.exports.WebUser    = WebUser;
