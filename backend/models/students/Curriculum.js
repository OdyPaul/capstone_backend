const mongoose = require('mongoose');
let sconn = null;

// Try to grab the students conn if the app already initialized it.
// If we’re in a standalone script (no connectAll ran), we’ll fall back to the
// default mongoose connection and it will work once the script calls mongoose.connect().
try {
  const { getStudentsConn } = require('../../config/db');
  sconn = typeof getStudentsConn === 'function' ? getStudentsConn() : null;
} catch (_) {
  sconn = null;
}

const CurriculumSchema = new mongoose.Schema({
  program:        { type: String, required: true },
  curriculumYear: { type: String, required: true },
  structure:      { type: Object, default: {} },
}, { timestamps: true });

// pick a connection: studentsConn (app) or default mongoose (scripts)
const conn = sconn || mongoose.connection;

// avoid OverwriteModelError when scripts run more than once
module.exports = conn.models.Curriculum || conn.model('Curriculum', CurriculumSchema);
