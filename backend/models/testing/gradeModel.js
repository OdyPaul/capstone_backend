// models/students/gradeModel.js
const mongoose = require('mongoose');

let sconn = null;
try {
  const { getStudentsConn } = require('../../config/db');
  sconn = typeof getStudentsConn === 'function' ? getStudentsConn() : null;
} catch (_) {
  sconn = null;
}

const GradeSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student_Data',
      required: true,
    },
    curriculum: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Curriculum',
      required: true,
    },

    // From curriculum.structure
    yearLevel: { type: String, required: true }, // e.g. "1St Year"
    semester: { type: String, required: true }, // e.g. "1St Semester", "Mid Year Term"

    subjectCode: { type: String, required: true }, // e.g. "BE 101"
    subjectTitle: { type: String }, // e.g. "Introduction to AB Engineering"
    units: { type: Number },

    // Term info (optional but nice)
    schoolYear: { type: String }, // e.g. "2024-2025"
    termName: { type: String }, // e.g. "1st Sem", "2nd Sem", "Mid-year", etc.

    // Actual academic result
    finalGrade: { type: Number, default: null },
    remarks: { type: String, default: null }, // "PASSED", "FAILED", "INC", etc.
  },
  { timestamps: true }
);

// Prevent duplicates: one grade per (student, curriculum, subjectCode, yearLevel, semester)
GradeSchema.index(
  {
    student: 1,
    curriculum: 1,
    subjectCode: 1,
    yearLevel: 1,
    semester: 1,
  },
  { unique: true }
);

const conn = sconn || mongoose.connection;
const Grade = conn.models.Grade || conn.model('Grade', GradeSchema);

module.exports = Grade;
