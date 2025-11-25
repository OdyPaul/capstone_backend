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
 * Load Student + Curriculum + Grades (TOR)
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

// ---------------------------------------------------------------------------
// Create *one* StudentData + synthetic Grade rows (used by /api/web/students)
// ---------------------------------------------------------------------------

function randomGwa() {
  const value = 1 + Math.random() * 2; // 1.00–3.00
  return Number(value.toFixed(2));
}

function getRandomGrade() {
  const grades = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];
  return grades[Math.floor(Math.random() * grades.length)];
}

function getRemarksFromGrade(grade) {
  if (grade == null) return null;
  return grade <= 3.0 ? 'PASSED' : 'FAILED';
}

function getTermNameFromSemester(semester) {
  const lower = (semester || '').toLowerCase();
  if (lower.includes('1st')) return '1st Sem';
  if (lower.includes('2nd')) return '2nd Sem';
  if (lower.includes('mid')) return 'Mid Year Term';
  return semester || null;
}

function safeDateFromY(year, month = 0, day = 1) {
  if (!year) return undefined;
  const d = new Date(Number(year), month, day);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

/**
 * Auto-generate a unique studentNumber of the form:
 *   C{baseYear}{5-digit-seq}
 * where baseYear ≈ graduationYear - 4 (or near current year if unknown).
 */
async function generateUniqueStudentNumber(graduationYear) {
  const now = new Date();
  const gradYearNum =
    graduationYear && !Number.isNaN(Number(graduationYear))
      ? Number(graduationYear)
      : now.getFullYear() + 4; // if grad year unknown, pretend 4 years ahead

  const baseYear = gradYearNum - 4;

  // Try multiple times to find a free ID
  for (let attempt = 0; attempt < 50; attempt++) {
    const index = Math.floor(Math.random() * 100000); // 0..99999
    const candidate = `C${baseYear}${String(index).padStart(5, '0')}`;
    const exists = await StudentData.exists({ studentNumber: candidate });
    if (!exists) return candidate;
  }

  throw new Error('Failed to generate unique student number');
}

async function createSingleStudentWithGrades(opts = {}) {
  const {
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
    graduationYear,
    dateOfBirth,
    randomizeMissing,
    photoUrl,
  } = opts;

  // ---------- 1. Derive names ----------
  let fName = (firstName || '').trim();
  let lName = (lastName || '').trim();
  let mName = (middleName || '').trim();

  // If not provided explicitly, try to derive from fullName
  if ((!fName || !lName) && fullName) {
    const parts = String(fullName).trim().split(/\s+/);
    if (!fName && parts.length) fName = parts[0];
    if (!lName && parts.length > 1) lName = parts[parts.length - 1];
    if (!mName && parts.length > 2) {
      mName = parts.slice(1, -1).join(' ');
    }
  }

  if (!fName || !lName) {
    const err = new Error('firstName and lastName are required');
    err.status = 400;
    throw err;
  }

  const computedFullName =
    fullName && fullName.trim()
      ? fullName.trim()
      : `${lName.toUpperCase()}, ${fName}${mName ? ' ' + mName : ''}`;

  // ---------- 2. Curriculum (optional) ----------
  let curriculumDoc = null;
  if (curriculumId && Curriculum && mongoose.isValidObjectId(curriculumId)) {
    curriculumDoc = await Curriculum.findById(curriculumId).lean();
  }

  // ---------- 3. Student number (required by schema, auto-generate if blank) ----------
  let stdNo = (studentNumber || '').trim();
  if (!stdNo) {
    stdNo = await generateUniqueStudentNumber(graduationYear);
  }

  // ---------- 4. Build Student_Data document ----------
  const studentDocData = {
    // required
    firstName: fName,
    lastName: lName,
    studentNumber: stdNo,

    // optional name fields
    middleName: mName || undefined,
    fullName: computedFullName,

    // program
    program: program || undefined,
    major: major || undefined,

    // demographics
    gender: gender ? String(gender).toLowerCase() : undefined,
    permanentAddress: address || undefined,
    placeOfBirth: placeOfBirth || undefined,
    highSchool: highSchool || undefined,
    shsSchool: highSchool || undefined,

    // dates
    dateOfBirth:
      dateOfBirth && !Number.isNaN(new Date(dateOfBirth))
        ? new Date(dateOfBirth)
        : undefined,

    // media
    photoUrl: photoUrl || undefined,
  };

  // Graduation year → dateAdmitted / dateGraduated
  let gradYearNum = null;
  if (graduationYear != null && graduationYear !== '') {
    const n = Number(graduationYear);
    if (!Number.isNaN(n)) gradYearNum = n;
  }

  if (gradYearNum) {
    const grad = safeDateFromY(gradYearNum, 3, 1); // April 1
    const admit = safeDateFromY(gradYearNum - 4, 5, 1); // June 1, four years earlier
    if (grad) studentDocData.dateGraduated = grad;
    if (admit) studentDocData.dateAdmitted = admit;
  }

  if (curriculumDoc && curriculumDoc._id) {
    studentDocData.curriculum = curriculumDoc._id;
    if (!studentDocData.program) {
      studentDocData.program =
        curriculumDoc.program ||
        curriculumDoc.name ||
        curriculumDoc.title ||
        undefined;
    }
  }

  // Optionally randomize some missing fields (testing only)
  if (randomizeMissing) {
    if (!studentDocData.permanentAddress) {
      studentDocData.permanentAddress = 'Magalang, Pampanga';
    }
    if (!studentDocData.collegeGwa) {
      studentDocData.collegeGwa = randomGwa();
    }
  }

  // ---------- 5. Save student ----------
  const student = await StudentData.create(studentDocData);

  // ---------- 6. Generate synthetic grades for this curriculum ----------
  let grades = [];
  if (curriculumDoc && curriculumDoc.structure) {
    const structure = curriculumDoc.structure;
    const schoolYearBase = gradYearNum || new Date().getFullYear();
    const schoolYear = `${schoolYearBase - 4}-${schoolYearBase - 3}`;

    const gradeDocs = [];

    Object.keys(structure).forEach((yearLevel) => {
      const yearBlock = structure[yearLevel] || {};
      Object.keys(yearBlock).forEach((semester) => {
        const semSubjects = yearBlock[semester] || [];
        semSubjects.forEach((s) => {
          if (!s.code || !String(s.code).trim()) return;

          const finalGrade = getRandomGrade();
          const remarks = getRemarksFromGrade(finalGrade);
          const termName = getTermNameFromSemester(semester);

          gradeDocs.push({
            student: student._id,
            curriculum: curriculumDoc._id,
            yearLevel,
            semester,
            subjectCode: String(s.code).trim(),
            subjectTitle: (s.title || '').toString(),
            units: Number(s.units || 0),
            schoolYear,
            termName,
            finalGrade,
            remarks,
          });
        });
      });
    });

    if (gradeDocs.length) {
      grades = await Grade.insertMany(gradeDocs);
    }
  }

  return {
    student: student.toObject ? student.toObject() : student,
    grades,
  };
}

module.exports = {
  seedStudentsAndGrades,
  loadStudentContext,
  createSingleStudentWithGrades,
};
