// backend/controllers/web/studentController.js
const Student = require("../../models/students/studentModel");
const asyncHandler = require("express-async-handler");
const escapeRegExp = require("../../utils/escapeRegExp");
const Curriculum = require("../../models/students/Curriculum");

// @desc    Get Passing Students
// @route   GET /api/student/passing
// @access  Private (University Personnel)
const getStudentPassing = asyncHandler(async (req, res) => {
  try {
    const { college, programs, year, q } = req.query;

    // base filter: passing students only
    const filter = { gwa: { $lte: 3.0 } };

    // College (exact, case-insensitive)
    if (college && college !== "All") {
      filter.college = { $regex: `^${escapeRegExp(college)}$`, $options: "i" };
    }

    // Programs: string or array
    if (programs && programs !== "All") {
      if (Array.isArray(programs)) {
        filter.program = { $in: programs.map((p) => String(p).toUpperCase()) };
      } else {
        filter.program = String(programs).toUpperCase();
      }
    }

    // Graduated year
    if (year && year !== "All") {
      const y = parseInt(year, 10);
      filter.dateGraduated = {
        $gte: new Date(`${y}-01-01`),
        $lte: new Date(`${y}-12-31`),
      };
    }

    // Free-text q across name / studentNumber / program
    if (q) {
      const safe = escapeRegExp(q);
      filter.$or = [
        { fullName: { $regex: safe, $options: "i" } },
        { studentNumber: { $regex: safe, $options: "i" } },
        { program: { $regex: safe, $options: "i" } },
      ];
    }

    // console.log("📌 Final filter:", filter);
    const students = await Student.find(filter);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// @desc    Get Student TOR
// @route   GET /api/student/:id/tor
// @access  Private (University Personnel)
const getStudentTor = asyncHandler(async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: "Student not found" });
    res.json(student.subjects || []);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch TOR" });
  }
});

// @desc    Search Students
// @route   GET /api/student/search
// @access  Private (University Personnel)
const searchStudent = asyncHandler(async (req, res) => {
  try {
    const { q } = req.query;
    const filter = {};

    if (q) {
      const safe = escapeRegExp(q);
      filter.$or = [
        { fullName: { $regex: safe, $options: "i" } },
        { studentNumber: { $regex: safe, $options: "i" } },
        { program: { $regex: safe, $options: "i" } },
      ];
    }

    const students = await Student.find(filter);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// @desc    Find Single Student
// @route   GET /api/student/:id
// @access  Private (University Personnel)
const findStudent = asyncHandler(async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: "Student not found" });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch student" });
  }
});
/**
 * @desc   Search Programs (from Curriculum collection)
 * @route  GET /api/web/programs?q=&limit=
 * @access Private (University Personnel)
 */
const searchPrograms = asyncHandler(async (req, res) => {
  const { q = "", limit = 10 } = req.query;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

  const filter = {};
  if (q) {
    const safe = escapeRegExp(String(q));
    filter.$or = [
      { program: { $regex: safe, $options: "i" } },
      { curriculumYear: { $regex: safe, $options: "i" } },
    ];
  }

  const docs = await Curriculum.find(
    filter,
    { program: 1, curriculumYear: 1 } // projection
  )
    .sort({ program: 1, curriculumYear: -1 })
    .limit(lim)
    .lean();

  // Frontend expects an array
  res.json(docs);
});

module.exports = {
  getStudentPassing,
  getStudentTor,
  searchStudent,
  findStudent,
  searchPrograms, 
};
