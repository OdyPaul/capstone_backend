// models/common/userModel.js
const mongoose = require('mongoose');
const { getAuthConn, getVcConn /*, getStudentsConn*/ } = require('../../config/db');
const readonlyPlugin = require('../_plugins/readonly');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },            // ← you asked for username
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['student','staff','admin','developer'], default: 'student' },
  did:      { type: String, unique: true, sparse: true },
  verified: { type: String, enum: ['unverified','verified'], default: 'unverified' },
}, { timestamps: true });

// Canonical model: lives in the AUTH DB (the only place we write Users)
const AuthUser = getAuthConn().model('User', userSchema);

// ---- Shadow registrations (optional but enables populate across DBs) ----
// We CLONE the schema so the read-only plugin won't affect the auth model.
const shadowSchemaVC = userSchema.clone();
shadowSchemaVC.plugin(readonlyPlugin, { modelName: 'User (shadow on vcConn)' });

// register on vcConn ONLY if not already registered (avoids OverwriteModelError)
const vcConn = getVcConn();
try { vcConn.model('User'); } catch { vcConn.model('User', shadowSchemaVC); }

// If you need populate from the students DB too, you can register a second shadow:
// const studentsConn = getStudentsConn();
// try { studentsConn.model('User'); } catch {
//   const shadowSchemaStudents = userSchema.clone();
//   shadowSchemaStudents.plugin(readonlyPlugin, { modelName: 'User (shadow on studentsConn)' });
//   studentsConn.model('User', shadowSchemaStudents);
// }

module.exports = AuthUser;  // EXPORT the authoritative model (auth DB)
