// backend/services/studentService.js

const mongoose = require('mongoose');
const StudentData = require('../models/testing/studentDataModel');
const Grade = require('../models/testing/gradeModel');

let Curriculum = null;
try {
  Curriculum = require('../models/students/Curriculum');
} catch (_) {
  Curriculum = null;
}

const {
  flattenCurriculumSubjects,
  getRandomGrade,
  getRemarksFromGrade,
  getTermNameFromSemester,
  getSampleSchoolYear,
  fillMissingStudentFields,
} = require('../utils/seed_student');

const { toFullName } = require('./gradeService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Parse a fullName into first/middle/last (best effort)
function parseFullName(fullName) {
  const raw = String(fullName || '').trim();
  if (!raw) return {};

  // Format: "LASTNAME, First Middle"
  const commaIdx = raw.indexOf(',');
  if (commaIdx !== -1) {
    const last = raw.slice(0, commaIdx).trim();
    const rest = raw.slice(commaIdx + 1).trim();
    const parts = rest.split(/\s+/);
    const first = parts.shift() || '';
    const middle = parts.join(' ');
    return { firstName: first, middleName: middle, lastName: last };
  }

  // Fallback: "First Middle Last"
  const parts = raw.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0] };
  }
  const last = parts.pop();
  const first = parts.shift();
  const middle = parts.join(' ');
  return { firstName: first, middleName: middle, lastName: last };
}

// Generate unique student number like: C<year><00001>
async function generateUniqueStudentNumber(graduationYear) {
  const year = Number(graduationYear) || new Date().getFullYear();
  const prefix = `C${year}`;

  // Find highest existing studentNumber with this prefix
  const [last] = await StudentData.find({
    studentNumber: { $regex: `^${prefix}\\d{5}$` },
  })
    .sort({ studentNumber: -1 })
    .limit(1)
    .lean();

  let nextIndex = 1;
  if (last && typeof last.studentNumber === 'string') {
    const tail = last.studentNumber.slice(prefix.length); // last 5 digits
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n)) nextIndex = n + 1;
  }

  const padded = String(nextIndex).padStart(5, '0');
  return `${prefix}${padded}`;
}

// ---------------------------------------------------------------------------
// SINGLE STUDENT + GRADES (manual seed from frontend)
// ---------------------------------------------------------------------------

/**
 * Create a single StudentData + synthetic Grade rows (based on curriculum).
 *
 * options:
 *  - fullName, firstName, middleName, lastName
 *  - studentNumber (optional; auto-generated if blank)
 *  - program, major, curriculumId
 *  - gender, address, placeOfBirth, highSchool
 *  - dateOfBirth, graduationYear
 *  - randomizeMissing (bool) → fillMissingStudentFields(...)
 *  - photoUrl (already uploaded to Cloudinary)
 */
async function createSingleStudentWithGrades(options = {}) {
  let {
    fullName,
    firstName,
    middleName,
    lastName,
    studentNumber,
    program,
    major,
    curriculumId,
    gender,
    address,
    placeOfBirth,
    highSchool,
    dateOfBirth,
    graduationYear,
    randomizeMissing,
    photoUrl,
  } = options;

  randomizeMissing = Boolean(randomizeMissing);

  // ---------- Resolve name parts ----------
  const parsedFromFull = parseFullName(fullName);

  const finalFirstName =
    (firstName || parsedFromFull.firstName || '').trim();
  const finalLastName = (lastName || parsedFromFull.lastName || '').trim();
  const finalMiddleName =
    (middleName || parsedFromFull.middleName || '').trim();

  if (!finalFirstName || !finalLastName) {
    const err = new Error('firstName and lastName are required.');
    err.status = 400;
    throw err;
  }

  // Compose fullName if not given
  if (!fullName) {
    const parts = [];
    if (finalLastName) parts.push(finalLastName.toUpperCase() + ',');
    if (finalFirstName) parts.push(finalFirstName);
    if (finalMiddleName) parts.push(finalMiddleName);
    fullName = parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // ---------- Resolve curriculum (optional) ----------
  let curriculumDoc = null;
  if (curriculumId && Curriculum) {
    curriculumDoc = await Curriculum.findById(curriculumId).lean();
    if (!curriculumDoc) {
      const err = new Error('Curriculum not found');
      err.status = 404;
      throw err;
    }
  }

  // If program not specified but curriculum has one, use it
  if (!program && curriculumDoc && curriculumDoc.program) {
    program = curriculumDoc.program;
  }

  // ---------- Student Number ----------
  let stdNo = (studentNumber || '').trim();
  if (!stdNo) {
    stdNo = await generateUniqueStudentNumber(graduationYear);
  }

  // ---------- Build base StudentData doc ----------
  let studentDoc = {
    studentNumber: stdNo,
    fullName,
    firstName: finalFirstName,
    middleName: finalMiddleName || undefined,
    lastName: finalLastName,
    gender: gender ? String(gender).toLowerCase() : undefined,
    permanentAddress: address || undefined,
    placeOfBirth: placeOfBirth || undefined,
    program: program || undefined,
    major: major || undefined,
    highSchool: highSchool || undefined,
    shsSchool: highSchool || undefined,
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
    photoUrl: photoUrl || undefined,
  };

  // Graduation year → dateGraduated (roughly mid-year)
  if (graduationYear) {
    const y = Number(graduationYear);
    if (!Number.isNaN(y)) {
      studentDoc.dateGraduated = new Date(y, 3, 15); // Apr 15 of that year
    }
  }

  if (curriculumDoc) {
    studentDoc.curriculum = curriculumDoc._id;
    if (curriculumDoc.college) {
      studentDoc.college = curriculumDoc.college;
    }
  }

  // ---------- Randomize missing fields (address, HS, DOB, etc) ----------
  if (randomizeMissing) {
    studentDoc = fillMissingStudentFields(studentDoc, {
      graduationYear,
    });
  }

  // ---------- Save Student ----------
  const student = await StudentData.create(studentDoc);

  // ---------- Create Grades (TOR) if curriculum available ----------
  let grades = [];
  if (curriculumDoc) {
    const subjects = flattenCurriculumSubjects(curriculumDoc);
    if (subjects.length) {
      const schoolYear = getSampleSchoolYear();

      const gradeDocs = subjects.map((subj) => {
        const finalGrade = getRandomGrade();
        const remarks = getRemarksFromGrade(finalGrade);
        const termName = getTermNameFromSemester(subj.semester);

        return {
          student: student._id,
          curriculum: curriculumDoc._id,
          program: student.program,
          yearLevel: subj.yearLevel,
          semester: subj.semester,
          subjectCode: subj.subjectCode,
          subjectTitle: subj.subjectTitle,
          units: subj.units,
          schoolYear,
          termName,
          finalGrade,
          remarks,
        };
      });

      grades = await Grade.insertMany(gradeDocs);
    }
  }

  return {
    student: student.toObject(),
    grades: grades.map((g) => g.toObject()),
  };
}

// ---------------------------------------------------------------------------
// BULK SEEDING (unchanged behavior)
// ---------------------------------------------------------------------------

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
      dateOfBirth: row.dateOfBirth || row.DateOfBirth || null,
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
  createSingleStudentWithGrades,
};
