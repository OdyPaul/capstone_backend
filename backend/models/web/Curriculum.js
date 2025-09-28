//For generating dummy data

const mongoose = require("mongoose");

const SubjectSchema = new mongoose.Schema({
  subjectCode: String,
  subjectDescription: String,
  units: Number,
});

const CurriculumSchema = new mongoose.Schema({
  program: { type: String, required: true },
  curriculumYear: { type: String, required: true },
  structure: { type: Object, default: {} }, // dynamic object for years & semesters
});

module.exports = mongoose.model("Curriculum", CurriculumSchema);
