const express = require("express");
const router = express.Router();
const Student = require("../../models/web/studentModel");
const asyncHandler = require('express-async-handler')

const getStudentPassing = asyncHandler(async (req, res) => {
  try {
    const { college, programs, year, q } = req.query;

    // base filter: passing students only
    let filter = { gwa: { $lte: 3.0 } };

    // ✅ case-insensitive college filter
    if (college) {
      filter.college = { $regex: `^${college}$`, $options: "i" };
    }

    // ✅ program(s) filter with case-insensitive matching
    if (programs) {
      if (Array.isArray(programs)) {
        filter.program = { $in: programs.map(p => new RegExp(`^${p}$`, "i")) };
      } else if (typeof programs === "string") {
        if (programs.includes(",")) {
          filter.program = {
            $in: programs.split(",").map(p => new RegExp(`^${p}$`, "i")),
          };
        } else {
          filter.program = { $regex: `^${programs}$`, $options: "i" };
        }
      }
    }

    // ✅ handle year (works if number or string)
    if (year) {
      if (!isNaN(year)) {
        filter.dateGraduated = Number(year); // stored as number
      } else {
        filter.dateGraduated = { $regex: `^${year}$` }; // stored as string
      }
    }

    // search across fields
    if (q) {
      filter.$or = [
        { fullName: { $regex: q, $options: "i" } },
        { studentNumber: { $regex: q, $options: "i" } },
        { program: { $regex: q, $options: "i" } },
      ];
    }

    const students = await Student.find(filter);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


 //@desc  Get Student TOR
//@route  GET /api/:id/tor
//@Access Private (University Personel)
 const getStudentTor = asyncHandler(async(req,res) =>{
    try {
    const student = await Student.findById(req.params.id);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json(student.subjects || []);  // ✅ return subjects as TOR
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch TOR" });
  }
 })

//@desc  Search Function
//@route  GET /api/search
//@Access Private (University Personel)
const searchStudent = asyncHandler(async(req,res) =>{
  try {
    const { q } = req.query;
    let filter = {};

    if (q) {
      filter.$or = [
        { fullName: { $regex: q, $options: "i" } },
        { studentNumber: { $regex: q, $options: "i" } },
        { program: { $regex: q, $options: "i" } },
      ];
    }

    const students = await Student.find(filter);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

//@desc  Search Singe Student
//@route  GET /api/:id
//@Access Private (University Personel)

const findStudent = asyncHandler(async(req,res)=>{
      try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json(student); // return full student object
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch student" });
  }
})


module.exports = {
    getStudentPassing,
    getStudentTor,
    searchStudent,
    findStudent,
}