// backend/controllers/web/studentController.js
const asyncHandler = require('express-async-handler');
const { isValidObjectId } = require('mongoose');

const StudentData = require('../../models/testing/studentDataModel');
const Grade = require('../../models/students/gradeModel');
const Curriculum = require('../../models/testing/gradeModel');

const escapeRegExp = require('../../utils/escapeRegExp');
const cloudinary = require('../../utils/cloudinary');

function minusYears(dateLike, years) {
  const d = new Date(dateLike);
  if (isNaN(d)) return undefined;
  d.setFullYear(d.getFullYear() - Number(years || 0));
  return d;
}

async function uploadDataUriToCloudinary(dataUri, folder = 'students_data') {
  if (!/^data:image\//i.test(String(dataUri || ''))) return null;
  const res = await cloudinary.uploader.upload(dataUri, { folder });
  return (res && res.secure_url) || null;
}

// ---------- Normalizers / helpers ----------

function toFullName(s) {
  if (!s) return '';
  if (s.fullName) return String(s.fullName).trim();

  const parts = [];
  if (s.lastName) parts.push(String(s.lastName).toUpperCase() + ',');
  if (s.firstName) parts.push(String(s.firstName));
  if (s.middleName) parts.push(String(s.middleName));
  if (s.extName) parts.push(String(s.extName));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeStudentForList(s) {
  if (!s) return null;
  return {
    _id: s._id,
    studentNumber: s.studentNumber,
    fullName: toFullName(s),
    program: s.program || '',
    major: s.major || '',
    dateAdmission: s.dateAdmission || s.dateAdmitted || null,
    dateGraduated: s.dateGraduated || null,
    gwa:
      s.gwa !== undefined && s.gwa !== null
        ? s.gwa
        : s.collegeGwa !== undefined && s.collegeGwa !== null
        ? s.collegeGwa
        : null,
    honor: s.honor || s.collegeAwardHonor || '',
    photoUrl: s.photoUrl || null,
    curriculum: s.curriculum || null,
    college: s.college || null,
  };
}

function normalizeStudentForDetail(s) {
  if (!s) return null;
  const base = normalizeStudentForList(s) || {};
  return {
    ...base,
    lastName: s.lastName,
    firstName: s.firstName,
    middleName: s.middleName,
    extName: s.extName,
    gender: s.gender,
    address: s.address || s.permanentAddress || '',
    placeOfBirth: s.placeOfBirth || '',
    highSchool: s.highSchool || s.shsSchool || s.jhsSchool || '',
    entranceCredentials: s.entranceCredentials || '',
    collegeGwa:
      s.collegeGwa !== undefined && s.collegeGwa !== null
        ? s.collegeGwa
        : s.gwa !== undefined && s.gwa !== null
        ? s.gwa
        : null,
    collegeAwardHonor: s.collegeAwardHonor || s.honor || '',
    jhsSchool: s.jhsSchool || '',
    shsSchool: s.shsSchool || '',
  };
}

// ---------- GET /student/passing ----------
// Uses Student_Data
const getStudentPassing = asyncHandler(async (req, res) => {
  const { college, programs, year, q } = req.query;

  const and = [];

  // Base: "passing" – but include students with no GWA yet
  and.push({
    $or: [
      { gwa: { $lte: 3.0 } },
      { collegeGwa: { $lte: 3.0 } },
      {
        $and: [
          { gwa: { $exists: false } },
          { collegeGwa: { $exists: false } },
        ],
      },
    ],
  });

  if (college && college !== 'All') {
    and.push({
      college: {
        $regex: `^${escapeRegExp(college)}$`,
        $options: 'i',
      },
    });
  }

  if (programs && programs !== 'All') {
    if (Array.isArray(programs)) {
      and.push({
        program: {
          $in: programs.map((p) => String(p).toUpperCase()),
        },
      });
    } else {
      and.push({
        program: String(programs).toUpperCase(),
      });
    }
  }

  if (year && year !== 'All') {
    const y = parseInt(year, 10);
    if (!Number.isNaN(y)) {
      and.push({
        dateGraduated: {
          $gte: new Date(`${y}-01-01`),
          $lte: new Date(`${y}-12-31`),
        },
      });
    }
  }

  if (q) {
    const safe = escapeRegExp(q);
    and.push({
      $or: [
        { fullName: { $regex: safe, $options: 'i' } },
        { lastName: { $regex: safe, $options: 'i' } },
        { firstName: { $regex: safe, $options: 'i' } },
        { middleName: { $regex: safe, $options: 'i' } },
        { studentNumber: { $regex: safe, $options: 'i' } },
        { program: { $regex: safe, $options: 'i' } },
      ],
    });
  }

  const filter = and.length ? { $and: and } : {};
  const students = await StudentData.find(filter).lean();
  const payload = students.map(normalizeStudentForList);
  res.json(payload);
});

// ---------- GET /student/:id/tor ----------
// TOR now comes from Grade collection
const getStudentTor = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid student id' });
  }

  const student = await StudentData.findById(id).lean();
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const grades = await Grade.find({ student: student._id }).lean();

  const YEAR_ORDER = [
    '1st Year',
    'First Year',
    '1st-year',
    '2nd Year',
    'Second Year',
    '3rd Year',
    'Third Year',
    '4th Year',
    'Fourth Year',
    '5th Year',
    'Sixth Year',
  ];
  const SEM_ORDER = [
    '1st Semester',
    'First Semester',
    '1st Sem',
    '2nd Semester',
    'Second Semester',
    '2nd Sem',
    'Mid Year Term',
    'Mid-year',
    'Mid Year',
    'Summer',
  ];

  const norm = (v) => String(v || '').trim().toLowerCase();
  const orderIndex = (v, list) => {
    const idx = list.findIndex((x) => norm(x) === norm(v));
    return idx === -1 ? 999 : idx;
  };

  grades.sort((a, b) => {
    const ya = orderIndex(a.yearLevel, YEAR_ORDER);
    const yb = orderIndex(b.yearLevel, YEAR_ORDER);
    if (ya !== yb) return ya - yb;

    const sa = orderIndex(a.semester, SEM_ORDER);
    const sb = orderIndex(b.semester, SEM_ORDER);
    if (sa !== sb) return sa - sb;

    return String(a.subjectCode || '').localeCompare(
      String(b.subjectCode || '')
    );
  });

  const payload = grades.map((g) => ({
    subjectCode: g.subjectCode,
    subjectDescription: g.subjectTitle,
    finalGrade: g.finalGrade,
    units: g.units,
    remarks: g.remarks,
    yearLevel: g.yearLevel,
    semester: g.semester,
    schoolYear: g.schoolYear,
    termName: g.termName,
  }));

  res.json(payload);
});

// ---------- GET /student/search ----------
const searchStudent = asyncHandler(async (req, res) => {
  const { q, college, programs } = req.query;
  const and = [];

  if (college && college !== 'All') {
    and.push({
      college: {
        $regex: `^${escapeRegExp(college)}$`,
        $options: 'i',
      },
    });
  }

  if (programs && programs !== 'All') {
    if (Array.isArray(programs)) {
      and.push({
        program: {
          $in: programs.map((p) => String(p).toUpperCase()),
        },
      });
    } else {
      and.push({
        program: String(programs).toUpperCase(),
      });
    }
  }

  if (q) {
    const safe = escapeRegExp(q);
    and.push({
      $or: [
        { fullName: { $regex: safe, $options: 'i' } },
        { lastName: { $regex: safe, $options: 'i' } },
        { firstName: { $regex: safe, $options: 'i' } },
        { middleName: { $regex: safe, $options: 'i' } },
        { studentNumber: { $regex: safe, $options: 'i' } },
        { program: { $regex: safe, $options: 'i' } },
      ],
    });
  }

  const filter = and.length ? { $and: and } : {};
  const students = await StudentData.find(filter).lean();
  const payload = students.map(normalizeStudentForList);
  res.json(payload);
});

// ---------- GET /student/:id ----------
const findStudent = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid student id' });
  }

  const student = await StudentData.findById(id).lean();
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const payload = normalizeStudentForDetail(student);
  res.json(payload);
});

// ---------- GET /programs ----------
const searchPrograms = asyncHandler(async (req, res) => {
  const { q = '', limit = 10 } = req.query;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

  const filter = {};
  if (q) {
    const safe = escapeRegExp(String(q));
    filter.$or = [
      { program: { $regex: safe, $options: 'i' } },
      { curriculumYear: { $regex: safe, $options: 'i' } },
    ];
  }

  const docs = await Curriculum.find(
    filter,
    { program: 1, curriculumYear: 1 } // projection
  )
    .sort({ program: 1, curriculumYear: -1 })
    .limit(lim)
    .lean();

  res.json(docs);
});

// ---------- PATCH /students/:id ----------
const updateStudent = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid student id' });
  }

  const {
    fullName,
    extensionName,
    gender,
    address,
    placeOfBirth,
    highSchool,
    entranceCredentials,
    program,
    major,
    dateAdmission,
    dateGraduated,
    honor,
    photoDataUrl,
    curriculumId,
  } = req.body || {};

  const $set = {};

  if (typeof fullName === 'string') $set.fullName = fullName.trim();
  if (typeof extensionName === 'string') $set.extName = extensionName.trim();
  if (typeof gender === 'string') $set.gender = gender.toLowerCase();
  if (typeof address === 'string') $set.permanentAddress = address.trim();
  if (typeof placeOfBirth === 'string')
    $set.placeOfBirth = placeOfBirth.trim();
  if (typeof highSchool === 'string') {
    const hs = highSchool.trim();
    $set.highSchool = hs;
    $set.shsSchool = hs;
  }
  if (typeof entranceCredentials === 'string')
    $set.entranceCredentials = entranceCredentials.trim();
  if (typeof program === 'string') $set.program = program.trim();
  if (typeof major === 'string') $set.major = major.trim();
  if (typeof honor === 'string') {
    const h = honor.trim();
    $set.honor = h;
    $set.collegeAwardHonor = h;
  }

  // dates
  if (dateGraduated !== undefined && dateGraduated !== null) {
    const g = new Date(dateGraduated);
    if (!isNaN(g)) {
      $set.dateGraduated = g;
      if (dateAdmission === undefined) {
        const inferred = minusYears(g, 4);
        if (inferred) $set.dateAdmitted = inferred;
      }
    }
  }

  if (dateAdmission !== undefined && dateAdmission !== null) {
    const a = new Date(dateAdmission);
    if (!isNaN(a)) $set.dateAdmitted = a;
  }

  // photo
  if (typeof photoDataUrl === 'string' && /^data:image\//i.test(photoDataUrl)) {
    const url = await uploadDataUriToCloudinary(photoDataUrl, 'students_data');
    if (url) $set.photoUrl = url;
  }

  // curriculum switch (no grade regeneration – grades live in Grade collection)
  if (curriculumId !== undefined && curriculumId !== null) {
    if (!isValidObjectId(curriculumId)) {
      return res.status(400).json({ message: 'Invalid curriculumId' });
    }
    const cur = await Curriculum.findById(curriculumId).lean();
    if (!cur) {
      return res.status(404).json({ message: 'Curriculum not found' });
    }
    $set.curriculum = cur._id;
    if ($set.program === undefined) {
      $set.program = cur.program || cur.name || cur.title || undefined;
    }
  }

  const updated = await StudentData.findByIdAndUpdate(
    id,
    { $set },
    { new: true, runValidators: true }
  ).lean();

  if (!updated) {
    return res.status(404).json({ message: 'Student not found' });
  }

  const payload = normalizeStudentForDetail(updated);
  res.json(payload);
});

module.exports = {
  getStudentPassing,
  getStudentTor,
  searchStudent,
  findStudent,
  searchPrograms,
  updateStudent,
};
