// models/students/studentModel.js
const mongoose = require('mongoose');
const { getStudentsConn, getVcConn } = require('../../config/db');
const readonly = require('../_plugins/readonly');
const sconn = getStudentsConn();
const vconn = getVcConn();

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
  studentNumber: { type: String, required: true, unique: true }, // unique here ✅
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

// ❌ REMOVE this to avoid duplicate index warnings
// StudentSchema.index({ studentNumber: 1 }, { unique: true });

// Canonical student model lives in the students DB
const Student = sconn.model('Student_Profiles', StudentSchema);

// Register a read-only shadow on the VC connection so populate works there
try {
  vconn.model('Student_Profiles');
} catch {
  const shadow = StudentSchema.clone();
  shadow.plugin(readonly, { modelName: 'Student_Profiles (shadow on vcConn)' });
  vconn.model('Student_Profiles', shadow);
}

module.exports = Student;
