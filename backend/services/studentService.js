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
  getRandomMagalangAddress,
  randomAdmissionAndGraduation,
  randomAdmissionAndGraduationForGradDate,
  randomGwa,
  randomHonor,
  randomSchoolName,
  randomEntranceCredential,
  randomPlaceOfBirth,
  randomDateOfBirthForAdmission,
  getSampleSchoolYear,
  makeGradeRowsForCurriculum,
} = require('../utils/seed_students');

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

/**
 * Generate a unique student number of the form `CYYYYNNNNN`.
 */
async function generateUniqueStudentNumber(baseYear) {
  const year = String(baseYear || new Date().getFullYear());
  const maxAttempts = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `C${year}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await StudentData.exists({ studentNumber: candidate });
    if (!exists) return candidate;
  }

  throw new Error('Failed to generate unique student number');
}

/**
 * Create a single StudentData document + synthetic Grade documents
 * based on program/curriculum and optional randomization.
 *
 * This is used by the web POST /api/web/students endpoint.
 */
async function createSingleStudentWithGrades(options = {}) {
  const {
    fullName,
    studentNumber: rawStudentNumber,
    program: rawProgram,
    major: rawMajor,
    curriculumId,
    gender: rawGender,
    address: rawAddress,
    placeOfBirth: rawPlaceOfBirth,
    highSchool: rawHighSchool,
    honor: rawHonor,
    dateGraduated: rawDateGraduated,
    dateOfBirth: rawDateOfBirth,
    randomizeMissing = false,
    photoUrl,
  } = options;

  if (!fullName || !fullName.trim()) {
    throw Object.assign(new Error('fullName is required'), { status: 400 });
  }

  let program = rawProgram ? String(rawProgram).trim() : '';
  let major = rawMajor ? String(rawMajor).trim() : '';
  let gender = rawGender ? String(rawGender).toLowerCase().trim() : '';
  let address = rawAddress ? String(rawAddress).trim() : '';
  let placeOfBirth = rawPlaceOfBirth
    ? String(rawPlaceOfBirth).trim()
    : '';
  let highSchool = rawHighSchool ? String(rawHighSchool).trim() : '';
  let honor = rawHonor ? String(rawHonor).trim() : '';

  let dateGraduated = rawDateGraduated
    ? new Date(rawDateGraduated)
    : null;
  if (dateGraduated && Number.isNaN(dateGraduated.getTime())) {
    dateGraduated = null;
  }

  let dateOfBirth = rawDateOfBirth ? new Date(rawDateOfBirth) : null;
  if (dateOfBirth && Number.isNaN(dateOfBirth.getTime())) {
    dateOfBirth = null;
  }

  // Curriculum selection
  let curriculumDoc = null;
  if (Curriculum) {
    if (curriculumId && mongoose.isValidObjectId(curriculumId)) {
      curriculumDoc = await Curriculum.findById(curriculumId).lean();
    } else if (program) {
      curriculumDoc = await Curriculum.findOne({
        program: String(program),
      })
        .sort({ curriculumYear: -1 })
        .lean();
    }
  }

  // Admission + Graduation dates
  let dateAdmitted = null;

  if (dateGraduated && randomizeMissing) {
    const pair = randomAdmissionAndGraduationForGradDate(dateGraduated);
    dateAdmitted = pair.dateAdmitted;
    dateGraduated = pair.dateGraduated;
  } else if (!dateGraduated && randomizeMissing) {
    const pair = randomAdmissionAndGraduation();
    dateAdmitted = pair.dateAdmitted;
    dateGraduated = pair.dateGraduated;
  } else if (dateGraduated && !randomizeMissing) {
    const ad = new Date(dateGraduated);
    ad.setFullYear(ad.getFullYear() - 4);
    dateAdmitted = ad;
  }

  // Randomize other fields if requested
  if (!gender && randomizeMissing) {
    gender = getRandomGender();
  }

  if (!address && randomizeMissing) {
    address = getRandomMagalangAddress();
  }

  if (!placeOfBirth && randomizeMissing) {
    placeOfBirth = randomPlaceOfBirth();
  }

  if (!highSchool && randomizeMissing) {
    highSchool = randomSchoolName('SHS');
  }

  let collegeGwa = null;
  if (randomizeMissing) {
    collegeGwa = randomGwa();
    if (!honor) honor = randomHonor(collegeGwa);
  }

  if (!dateOfBirth && randomizeMissing) {
    const baseAdmission =
      dateAdmitted ||
      (dateGraduated
        ? new Date(dateGraduated.getFullYear() - 4, 0, 1)
        : new Date());
    dateOfBirth = randomDateOfBirthForAdmission(baseAdmission);
  }

  // Generate studentNumber if missing
  let studentNumber = rawStudentNumber
    ? String(rawStudentNumber).trim()
    : '';
  const baseYear =
    (dateAdmitted && dateAdmitted.getFullYear()) ||
    (dateGraduated && dateGraduated.getFullYear()) ||
    new Date().getFullYear();

  if (!studentNumber) {
    studentNumber = await generateUniqueStudentNumber(baseYear);
  }

  // Fallback program from curriculum if needed
  if (!program && curriculumDoc && curriculumDoc.program) {
    program = curriculumDoc.program;
  }

  // Create StudentData document
  const studentDoc = await StudentData.create({
    studentNumber,
    fullName: fullName.trim(),
    program,
    major,
    gender,
    permanentAddress: address,
    placeOfBirth,
    highSchool,
    shsSchool: highSchool || undefined,
    jhsSchool: undefined,
    collegeAwardHonor: honor || undefined,
    honor: honor || undefined,
    collegeGwa,
    gwa: collegeGwa,
    entranceCredentials: randomizeMissing
      ? randomEntranceCredential()
      : undefined,
    dateAdmitted: dateAdmitted || undefined,
    dateGraduated: dateGraduated || undefined,
    dateOfBirth: dateOfBirth || undefined,
    curriculum: curriculumDoc ? curriculumDoc._id : undefined,
    photoUrl: photoUrl || undefined,
  });

  // Generate Grade documents based on curriculum
  let gradeDocs = [];
  if (curriculumDoc) {
    const sy = getSampleSchoolYear();
    const gradeRows = makeGradeRowsForCurriculum({
      studentId: studentDoc._id,
      curriculum: curriculumDoc,
      program,
      schoolYear: sy,
    });

    if (gradeRows.length) {
      gradeDocs = await Grade.insertMany(gradeRows);
    }
  }

  const studentPlain =
    typeof studentDoc.toObject === 'function'
      ? studentDoc.toObject()
      : studentDoc;
  const gradesPlain = gradeDocs.map((g) =>
    typeof g.toObject === 'function' ? g.toObject() : g,
  );

  return { student: studentPlain, grades: gradesPlain };
}

module.exports = {
  seedStudentsAndGrades,
  loadStudentContext,
  createSingleStudentWithGrades,
};
