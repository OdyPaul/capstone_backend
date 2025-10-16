// models/students/curriculumModel.js
const mongoose = require('mongoose');
const { getStudentsConn } = require('../../config/db');
const sconn = getStudentsConn();

const CurriculumSchema = new mongoose.Schema({
  program:        { type: String, required: true },
  curriculumYear: { type: String, required: true },
  structure:      { type: Object, default: {} },
}, { timestamps: true });

module.exports = sconn.model('Curriculum', CurriculumSchema);
