// services/studentService.js

const mongoose = require('mongoose');
const StudentData = require('../models/testing/studentDataModel');
const Grade = require('../models/testing/gradeModel');

let Curriculum = null;
try {
  Curriculum = require('../models/students/Curriculum');
} catch (_) {
  Curriculum = null;
}

const { toFullName } = require('./gradeService');

/**
 * Seed / upsert StudentData + Grade from spreadsheet-style payload
 * (restores behavior from original seedStudentsAndGradesFromPayload).
 */
async function seedStudentsAndGrades({ studentDataRows = [], gradeRows = [] }) {
  if (!Array.isArray(studentDataRows)) studentDataRows = [];
  if (!Array.isArray(gradeRows)) gradeRows = [];

  const byStudentNo = new Map();

  // ---- upsert students ---------------------------------------------------
  for (const row of studentDataRows) {
    const studentNumber = String(
      row.studentNumber ||
        row.StudentNo ||
        row.STUDENT_NO ||
        row['Student No'] ||
        '',
    ).trim();

    if (!studentNumber) continue;

    let student = await StudentData.findOne({ studentNumber });

    const baseDoc = {
      studentNumber,
      lastName: row.lastName || row.LastName || '',
      firstName: row.firstName || row.FirstName || '',
      middleName: row.middleName || row.MiddleName || '',
      extName: row.extName || row.ExtName || '',
      gender: row.gender || row.Gender || '',
      permanentAddress:
        row.permanentAddress || row.Perm_Address || row.Address || '',
      major: row.major || row.Major || '',
      collegeGwa:
        row.collegeGwa !== undefined && row.collegeGwa !== null
          ? row.collegeGwa
          : row.College_Gwa !== undefined && row.College_Gwa !== ''
          ? Number(row.College_Gwa)
          : null,
      dateAdmitted: row.dateAdmitted || row.DateAdmitted || null,
      dateGraduated: row.dateGraduated || row.DateGraduated || null,
      placeOfBirth: row.placeOfBirth || row.PlaceOfBirth || '',
      collegeAwardHonor:
        row.collegeAwardHonor || row.College_AwardHonor || '',
      entranceCredentials:
        row.entranceCredentials ||
        row.EntranceData_AdmissionCredential ||
        '',
      jhsSchool: row.jhsSchool || row.JHS_School || '',
      shsSchool: row.shsSchool || row.SHS_School || '',
      program: row.program || row.Program || '',
      photoUrl: row.photoUrl || row.PhotoUrl || '',
    };

    if (!student) {
      student = await StudentData.create(baseDoc);
    } else {
      Object.assign(student, baseDoc);
      await student.save();
    }

    byStudentNo.set(studentNumber, student);
  }

  // ---- upsert grades -----------------------------------------------------
  for (const row of gradeRows) {
    const studentNumber = String(
      row.studentNumber ||
        row.StudentNo ||
        row.STUDENT_NO ||
        row['Student No'] ||
        '',
    ).trim();

    if (!studentNumber) continue;

    let student = byStudentNo.get(studentNumber);
    if (!student) {
      student = await StudentData.findOne({ studentNumber });
      if (!student) continue; // still nothing, skip grade
      byStudentNo.set(studentNumber, student);
    }

    const gradeDoc = {
      student: student._id,
      yearLevel: row.yearLevel || row.YearLevel || '',
      semester: row.semester || row.Semester || '',
      subjectCode: row.subjectCode || row.SubjectCode || '',
      subjectTitle: row.subjectTitle || row.SubjectTitle || '',
      units:
        row.units !== undefined && row.units !== null
          ? row.units
          : row.Units !== undefined && row.Units !== ''
          ? Number(row.Units)
          : null,
      schoolYear: row.schoolYear || row.SchoolYear || '',
      termName: row.termName || row.TermName || '',
      finalGrade:
        row.finalGrade !== undefined && row.finalGrade !== null
          ? row.finalGrade
          : row.FinalGrade !== undefined && row.FinalGrade !== ''
          ? Number(row.FinalGrade)
          : null,
      remarks: row.remarks || row.Remarks || '',
    };

    // Avoid duplicates: upsert by (student + subjectCode + schoolYear + termName)
    await Grade.updateOne(
      {
        student: gradeDoc.student,
        subjectCode: gradeDoc.subjectCode,
        schoolYear: gradeDoc.schoolYear,
        termName: gradeDoc.termName,
      },
      { $set: gradeDoc },
      { upsert: true },
    );
  }

  return byStudentNo;
}

/**
 * Load Student + Curriculum + Grades (TOR) – matches original loadStudentAndContext.
 */
async function loadStudentContext({ studentId, studentNumber, needGrades }) {
  let studentDoc = null;

  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      throw Object.assign(new Error('Invalid studentId'), { status: 400 });
    }
    studentDoc = await StudentData.findById(studentId).lean();
  } else if (studentNumber) {
    studentDoc = await StudentData.findOne({
      studentNumber: String(studentNumber).trim(),
    }).lean();
  }

  if (!studentDoc) {
    throw Object.assign(new Error('Student not found'), { status: 404 });
  }

  const student = {
    ...studentDoc,
    fullName: toFullName(studentDoc),
  };

  // Curriculum (optional)
  let curriculumDoc = null;
  if (student.curriculum && Curriculum) {
    try {
      curriculumDoc = await Curriculum.findById(student.curriculum).lean();
    } catch (_) {
      /* ignore */
    }
  }

  // Grades (optionally filtered by curriculum for TOR)
  let grades = [];
  if (needGrades) {
    grades = await Grade.find({
      student: student._id,
      ...(student.curriculum ? { curriculum: student.curriculum } : {}),
    }).lean();
  }

  return { student, curriculumDoc, grades };
}

module.exports = {
  seedStudentsAndGrades,
  loadStudentContext,
};
