// models/Student.js
const mongoose = require("mongoose");

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
  address: String, // 👈 merged perm or res address
  entranceCredentials: String,
  highSchool: String,
  program: String, // DegreeTitle
  major: String,
  dateAdmission: Date,
  placeOfBirth: String,
  dateGraduated: Date,
  gwa: Number,
  honor: String,
  subjects: [SubjectSchema],
  curriculum: { type: mongoose.Schema.Types.ObjectId, ref: "Curriculum" },
});

module.exports = mongoose.model("Student_Profiles", StudentSchema);
