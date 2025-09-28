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
  studentNumber: String,
  fullName: String,
  program: String,
  dateGraduated: String,
  gwa: Number,
  honor: String,
  subjects: [SubjectSchema],
  curriculum: { type: mongoose.Schema.Types.ObjectId, ref: "Curriculum" }  // <- add this
});


module.exports = mongoose.model("Student", StudentSchema);
