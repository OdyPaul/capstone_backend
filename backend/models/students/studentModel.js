// models/students/studentModel.js
const mongoose = require('mongoose');

let sconn = null;
let vconn = null;

// Try to grab app-managed connections if available (server mode).
// In scripts, this will throw/return undefined — we fall back to mongoose.connection.
try {
  const { getStudentsConn, getVcConn } = require('../../config/db');
  sconn = typeof getStudentsConn === 'function' ? getStudentsConn() : null;
  vconn = typeof getVcConn === 'function' ? getVcConn() : null;
} catch (_) {
  sconn = null;
  vconn = null;
}

const SubjectSchema = new mongoose.Schema({
  subjectCode: String,
  subjectDescription: String,
  finalGrade: Number,
  units: Number,
  remarks: String,
  yearLevel: String,
  semester: String,
});

const StudentSchema = new mongoose.Schema({
  studentNumber: { type: String, required: true, unique: true },
  fullName: String,
  extensionName: String,
  gender: String,
  address: String,
  entranceCredentials: String,
  highSchool: String,
  program: String,
  major: String,
  dateAdmission: Date,
  placeOfBirth: String,
  dateGraduated: Date,
  gwa: Number,
  honor: String,
  subjects: [SubjectSchema],
  curriculum: { type: mongoose.Schema.Types.ObjectId, ref: 'Curriculum' },
}, { timestamps: true });

// Use studentsConn in server mode; default mongoose connection in script mode
const studentsConnection = sconn || mongoose.connection;

// Avoid OverwriteModelError if file is imported multiple times
const Student =
  studentsConnection.models['Student_Profiles'] ||
  studentsConnection.model('Student_Profiles', StudentSchema);

// (Optional) Register a read-only shadow on the VC connection if available (server mode)
try {
  if (vconn && !vconn.models['Student_Profiles']) {
    const readonly = require('../_plugins/readonly');
    const shadow = StudentSchema.clone();
    try {
      shadow.plugin(readonly, { modelName: 'Student_Profiles (shadow on vcConn)' });
    } catch (_) { /* plugin optional in scripts */ }
    vconn.model('Student_Profiles', shadow);
  }
} catch (_) {
  // Fine to ignore in scripts
}

module.exports = Student;
