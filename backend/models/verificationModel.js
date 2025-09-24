const mongoose = require('mongoose');

// Common schema for verification files
const verificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    purpose: {
      type: String,
      enum: ['user_face', 'valid_id'],
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    data: {
      type: Buffer,
      required: true,
    },
    contentType: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // admin who reviewed
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Verification', verificationSchema);
