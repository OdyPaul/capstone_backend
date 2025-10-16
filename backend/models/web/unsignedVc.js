// models/web/unsignedVc.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const unsignedVcSchema = new mongoose.Schema(
  {
    // IMPORTANT: this must match the model name you exported in studentModel:
    // module.exports = mongoose.model("Student_Profiles", StudentSchema)
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student_Profiles',
      required: true,
    },

    // e.g. 'TOR' | 'Diploma' | 'COG'
    type: { type: String, required: true },

    // e.g. 'Employment', 'Board Exam', etc.
    purpose: { type: String, required: true },

    // optional; many schools' TORs don’t expire
    expiration: { type: Date, default: null },
  },
  { timestamps: true }
);

// Nice-to-have: enforce “one draft per student/type/purpose”
unsignedVcSchema.index(
  { student: 1, type: 1, purpose: 1 },
  { unique: true, name: 'uniq_student_type_purpose' }
);

module.exports = vconn.model('UnsignedVC', unsignedVcSchema);
