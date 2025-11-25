// models/mobile/vcRequestModel.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db'); // adjust if needed

// Store enum in lowercase; controller lowercases purpose before validation
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
    // owning user (mobile account)
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // linked student profile
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student_Data', // keep as your actual Student model collection name
      required: true,
      index: true,
    },

    // denormalized fields for easy rendering (no $lookup needed)
    studentNumber: {
      type: String,
      index: true,
      default: null,
    },
    studentFullName: {
      type: String,
      default: null,
    },
    studentProgram: {
      type: String,
      default: null,
    },
    studentPhotoUrl: {
      type: String,
      default: null,
    }, 

    // TOR / DIPLOMA
    type: {
      type: String,
      enum: ['TOR', 'DIPLOMA'],
      required: true,
    },

    // purpose is normalized to lowercase so it matches PURPOSES enum
    purpose: {
      type: String,
      enum: PURPOSES,
      required: true,
      set: (v) => String(v || '').trim().toLowerCase(),
    },

    // whether student asked to anchor this VC after payment
    anchorNow: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'issued'],
      default: 'pending',
      index: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // optional link to auto-created VC draft
    draft: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VcDraft',
      default: null,
    },

    // optional mirror of payment tx no for this request
    paymentTxNo: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    bufferCommands: false,
  }
);

// ---- connection + model registration ----
function getConn() {
  const conn = typeof getVcConn === 'function' ? getVcConn() : null;
  return conn || mongoose; // fallback to default connection
}

let VCRequest;
const conn = getConn();

try {
  VCRequest = conn.model('VCRequest');
} catch {
  VCRequest = conn.model('VCRequest', vcRequestSchema);
}

module.exports = VCRequest;
module.exports.PURPOSES = PURPOSES;
