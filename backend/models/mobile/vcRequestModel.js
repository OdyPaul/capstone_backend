// ✅ COPY-READY
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db'); // VC DB connection
const vcConn = getVcConn(); // a Mongoose Connection

// Store enum in lowercase; we'll lowercase incoming values via a setter
const PURPOSES = [
  'employment',
  'further studies',
  'board examination / professional licensure',
  'scholarship / grant application',
  'personal / general reference',
  'overseas employment',
  'training / seminar',
];

const vcRequestSchema = new mongoose.Schema(
  {
    student:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student_Profiles', required: true, index: true },

    // ✅ denormalized identifiers for reliable rendering (even without $lookup)
    studentNumber:   { type: String, index: true, default: null },   // <-- NEW
    studentFullName: { type: String, default: null },                // optional
    studentProgram:  { type: String, default: null },                // optional
    studentPhotoUrl: { type: String, default: null },                // optional

    type:    { type: String, enum: ['TOR', 'DIPLOMA'], required: true },

    // normalize to lowercase so it matches enum
    purpose: { 
      type: String,
      enum: PURPOSES,
      required: true,
      set: (v) => String(v || '').trim().toLowerCase(),
    },

    status:     { type: String, enum: ['pending', 'approved', 'rejected', 'issued'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, bufferCommands: false }
);

// Avoid OverwriteModelError on hot-reloads
let VCRequest;
try {
  VCRequest = vcConn.model('VCRequest');
} catch {
  VCRequest = vcConn.model('VCRequest', vcRequestSchema);
}

module.exports = VCRequest;
module.exports.PURPOSES = PURPOSES;
