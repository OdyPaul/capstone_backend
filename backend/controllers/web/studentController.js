const express = require("express");
const router = express.Router();
const Student = require("../../models/web/studentModel");
const asyncHandler = require('express-async-handler')


//@desc  Get Passing Students
//@route  GET /api/students
//@Access Private (University Personel)
 const getStudentPassing = asyncHandler(async(req,res) => {
  try {
    const { search } = req.query;
    let filter = { gwa: { $lte: 3.0 } };

    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { studentNumber: { $regex: search, $options: "i" } },
        { program: { $regex: search, $options: "i" } },
      ];
    }

    const students = await Student.find(filter);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }

 })

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