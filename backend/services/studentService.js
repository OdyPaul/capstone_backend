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

const {
  fillMissingStudentFields,
  flattenCurriculumSubjects,
  getRandomGrade,
  getRemarksFromGrade,
  getTermNameFromSemester,
  getSampleSchoolYear,
} = require('../utils/seed_student');

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

// ---------------------------------------------------------------------------
// Single student + synthetic grades for program (used by web create)
// ---------------------------------------------------------------------------

async function generateStudentNumberForYear(year) {
  const y = Number(year) || new Date().getFullYear();
  const prefix = `C${y}`;

  const last = await StudentData.findOne({
    studentNumber: { $regex: `^${prefix}` },
  })
    .sort({ studentNumber: -1 })
    .lean();

  let next = 1;
  if (
    last &&
    last.studentNumber &&
    String(last.studentNumber).startsWith(prefix)
  ) {
    const suffix = Number(String(last.studentNumber).slice(prefix.length)) || 0;
    next = suffix + 1;
  }

  return `${prefix}${String(next).padStart(5, '0')}`;
}

/**
 * Create a single StudentData row + synthetic Grade rows for its Curriculum.
 */
async function createSingleStudentWithGrades(opts) {
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
    dateOfBirth,
    dateGraduated,
    graduationYear,
    randomizeMissing,
    photoUrl,
  } = opts || {};

  // Resolve curriculum (optional)
  let curriculumDoc = null;

  if (Curriculum && curriculumId) {
    if (!mongoose.isValidObjectId(curriculumId)) {
      const err = new Error('Invalid curriculumId');
      err.status = 400;
      throw err;
    }
    curriculumDoc = await Curriculum.findById(curriculumId).lean();
    if (!curriculumDoc) {
      const err = new Error('Curriculum not found');
      err.status = 404;
      throw err;
    }
  } else if (Curriculum && program) {
    curriculumDoc = await Curriculum.findOne({ program })
      .sort({ curriculumYear: -1 })
      .lean();
  }

  // ---------- Names ----------
  let fName = (firstName || '').trim();
  let lName = (lastName || '').trim();
  let mName = (middleName || '').trim();

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

  const studentDocData = {};

  studentDocData.firstName = fName;
  studentDocData.lastName = lName;
  if (mName) studentDocData.middleName = mName;

  // fullName display
  const computedFullName = `${lName.toUpperCase()}, ${fName}${
    mName ? ` ${mName}` : ''
  }`;
  studentDocData.fullName =
    (fullName && fullName.trim()) || computedFullName;

  // ---------- Student number ----------
  let finalStudentNo = (studentNumber || '').trim();
  const inferredGradYear =
    Number(graduationYear) ||
    (dateGraduated ? new Date(dateGraduated).getFullYear() : undefined);

  if (!finalStudentNo) {
    finalStudentNo = await generateStudentNumberForYear(
      inferredGradYear || new Date().getFullYear(),
    );
  }
  studentDocData.studentNumber = finalStudentNo;

  // ---------- Program / Curriculum ----------
  if (program) studentDocData.program = program;
  if (major) studentDocData.major = major;
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

  // ---------- Demographics ----------
  if (gender) studentDocData.gender = String(gender).toLowerCase();
  if (address) studentDocData.permanentAddress = address;
  if (placeOfBirth) studentDocData.placeOfBirth = placeOfBirth;

  if (highSchool) {
    studentDocData.highSchool = highSchool;
    studentDocData.shsSchool = highSchool;
  }

  if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    if (!Number.isNaN(dob.getTime())) {
      studentDocData.dateOfBirth = dob;
    }
  }

  // ---------- Graduation & Admission ----------
  let gradYearNum = null;

  if (graduationYear != null && graduationYear !== '') {
    const n = Number(graduationYear);
    if (!Number.isNaN(n) && n >= 1900 && n <= 2100) {
      gradYearNum = n;
    }
  }

  if (dateGraduated) {
    const g = new Date(dateGraduated);
    if (!Number.isNaN(g.getTime())) {
      studentDocData.dateGraduated = g;
      if (!studentDocData.dateAdmitted) {
        const admit = new Date(g);
        admit.setFullYear(admit.getFullYear() - 4);
        studentDocData.dateAdmitted = admit;
      }
      if (!gradYearNum) gradYearNum = g.getFullYear();
    }
  } else if (gradYearNum) {
    const g = new Date(gradYearNum, 3, 1); // April 1 of the grad year
    studentDocData.dateGraduated = g;
    const admit = new Date(gradYearNum - 4, 5, 1); // June 1 four years earlier
    studentDocData.dateAdmitted = admit;
  }

  // ---------- Photo ----------
  if (photoUrl) {
    studentDocData.photoUrl = photoUrl;
  }

  // ---------- Randomize missing fields (testing) ----------
  const finalStudentDocData = randomizeMissing
    ? fillMissingStudentFields(studentDocData, {
        graduationYear: gradYearNum,
      })
    : studentDocData;

  // Persist student
  const studentDoc = await StudentData.create(finalStudentDocData);

  // ---------- Synthetic Grades from Curriculum ----------
  let grades = [];
  if (curriculumDoc) {
    const subjects = flattenCurriculumSubjects(curriculumDoc);
    if (subjects && subjects.length) {
      const schoolYear = getSampleSchoolYear();
      const gradeDocs = subjects.map((s) => {
        const finalGrade = getRandomGrade();
        const remarks = getRemarksFromGrade(finalGrade);
        const termName = getTermNameFromSemester(s.semester);

        return {
          student: studentDoc._id,
          curriculum: curriculumDoc._id,
          yearLevel: s.yearLevel,
          semester: s.semester,
          subjectCode: s.subjectCode,
          subjectTitle: s.subjectTitle,
          units: s.units,
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
    student: studentDoc.toObject ? studentDoc.toObject() : studentDoc,
    grades,
  };
}

module.exports = {
  seedStudentsAndGrades,
  loadStudentContext,
  createSingleStudentWithGrades,
};
