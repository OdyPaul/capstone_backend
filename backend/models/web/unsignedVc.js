const mongoose = require('mongoose');

const unsignedVcSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  type: { type: String, required: true },   // ✅ flexible now
  purpose: { type: String, required: true },
  expiration: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('UnsignedVC', unsignedVcSchema);
