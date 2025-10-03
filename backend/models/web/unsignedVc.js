const mongoose = require('mongoose');

const unsignedVcSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    type: { type: String, required: true },
    purpose: { type: String, required: true },
    expiration: { type: Date }, // make optional if TOR has no expiration
  },
  { timestamps: true } // ✅ adds createdAt and updatedAt automatically
);

module.exports = mongoose.model('UnsignedVC', unsignedVcSchema);
