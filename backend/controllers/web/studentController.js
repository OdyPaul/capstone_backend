const express = require("express");
const router = express.Router();
const Student = require("../../models/students/studentModel");
const asyncHandler = require("express-async-handler");
const escapeRegExp = require('../../utils/escapeRegExp');

const q = req.query.q; // already validated & trimmed by zod
if (q) {
  const safe = escapeRegExp(q);
  filter.$or = [
    { fullName:      { $regex: safe, $options: 'i' } },
    { studentNumber: { $regex: safe, $options: 'i' } },
    { program:       { $regex: safe, $options: 'i' } },
  ];
}
// @desc    Get Passing Students
// @route   GET /api/student/passing
// @access  Private (University Personnel)
const getStudentPassing = asyncHandler(async (req, res) => {
  try {
    const { college, programs, year, q } = req.query;

    // base filter: passing students only
    let filter = { gwa: { $lte: 3.0 } };

    // ✅ College filter
    if (college && college !== "All") {
      filter.college = { $regex: `^${college}$`, $options: "i" };
    }

   
      // ✅ Programs filter (string or array)
      if (programs && programs !== "All") {
        if (Array.isArray(programs)) {
          // multiple → use $in
          filter.program = { $in: programs.map(p => p.toUpperCase()) };
        } else {
          // single program → exact match
          filter.program = programs.toUpperCase();
        }
      }



      if (req.query.year && req.query.year !== "All") {
        const year = parseInt(req.query.year, 10);
        filter.dateGraduated = {
          $gte: new Date(`${year}-01-01`),
          $lte: new Date(`${year}-12-31`),
        };
      }


    if (q) {
      const safe = escapeRegExp(q);
      const qUpper = q.toUpperCase(); // keep your exact-match option
      filter.$or = [
        { fullName:      { $regex: safe, $options: 'i' } },
        { studentNumber: { $regex: safe, $options: 'i' } },
        { program: qUpper }, // exact match fallback
      ];
    }



    console.log("📌 Final filter:", filter);

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

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json(student.subjects || []); // ✅ return subjects as TOR
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
    let filter = {};

        if (q) {
        const safe = escapeRegExp(q);
        filter.$or = [
          { fullName:      { $regex: safe, $options: 'i' } },
          { studentNumber: { $regex: safe, $options: 'i' } },
          { program:       { $regex: safe, $options: 'i' } },
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
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json(student); // return full student object
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch student" });
  }
});

module.exports = {
  getStudentPassing,
  getStudentTor,
  searchStudent,
  findStudent,
};
