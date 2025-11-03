// backend/controllers/web/studentController.js
const Student = require("../../models/students/studentModel");
const asyncHandler = require("express-async-handler");
const escapeRegExp = require("../../utils/escapeRegExp");
const Curriculum = require("../../models/students/Curriculum");
const { isValidObjectId } = require("mongoose");
const cloudinary = require("../../utils/cloudinary");
const { generateRandomGradesForCurriculum } = require("../../lib/createStudent");

function minusYears(dateLike, years) {
  const d = new Date(dateLike);
  if (isNaN(d)) return undefined;
  d.setFullYear(d.getFullYear() - Number(years || 0));
  return d;
}

async function uploadDataUriToCloudinary(dataUri, folder = "students_profiles") {
  if (!/^data:image\//i.test(String(dataUri || ""))) return null;
  const res = await cloudinary.uploader.upload(dataUri, { folder });
  return res?.secure_url || null;
}
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


// @desc    Update Student (partial)
// @route   PATCH /api/web/students/:id
// @access  Private (admin/superadmin)
const updateStudent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid student id" });

  // whitelist editable fields
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
    photoDataUrl,     // optional Data URI -> Cloudinary
    curriculumId,     // optional: switch curriculum
    regenSubjects,    // optional: if true and curriculum provided -> regenerate subjects/gwa
  } = req.body || {};

  const $set = {};

  if (typeof fullName === "string") $set.fullName = fullName.trim();
  if (typeof extensionName === "string") $set.extensionName = extensionName.trim();
  if (typeof gender === "string") $set.gender = gender.toLowerCase();
  if (typeof address === "string") $set.address = address.trim();
  if (typeof placeOfBirth === "string") $set.placeOfBirth = placeOfBirth.trim();
  if (typeof highSchool === "string") $set.highSchool = highSchool.trim();
  if (typeof entranceCredentials === "string") $set.entranceCredentials = entranceCredentials.trim();
  if (typeof program === "string") $set.program = program.trim();
  if (typeof major === "string") $set.major = major.trim();
  if (typeof honor === "string") $set.honor = honor.trim();

  // dates
  if (dateGraduated !== undefined && dateGraduated !== null) {
    const g = new Date(dateGraduated);
    if (!isNaN(g)) {
      $set.dateGraduated = g;
      // If admission not explicitly provided, infer = grad - 4y (your rule)
      if (dateAdmission === undefined) {
        const inferred = minusYears(g, 4);
        if (inferred) $set.dateAdmission = inferred;
      }
    }
  }
  if (dateAdmission !== undefined && dateAdmission !== null) {
    const a = new Date(dateAdmission);
    if (!isNaN(a)) $set.dateAdmission = a;
  }

  // photo
  if (typeof photoDataUrl === "string" && /^data:image\//i.test(photoDataUrl)) {
    const url = await uploadDataUriToCloudinary(photoDataUrl);
    if (url) $set.photoUrl = url;
  }

  // curriculum switch (optional)
  if (curriculumId !== undefined && curriculumId !== null) {
    if (!isValidObjectId(curriculumId)) {
      return res.status(400).json({ message: "Invalid curriculumId" });
    }
    const cur = await Curriculum.findById(curriculumId).lean();
    if (!cur) return res.status(404).json({ message: "Curriculum not found" });
    $set.curriculum = cur._id;
    // Fill program from curriculum if not explicitly provided in the payload
    if ($set.program === undefined) {
      $set.program = cur.program || cur.name || cur.title || undefined;
    }
    // regenerate subjects/gwa if asked
    if (regenSubjects) {
      const { subjects, gwa } = generateRandomGradesForCurriculum(cur);
      $set.subjects = subjects;
      $set.gwa = gwa;
    }
  }

  const updated = await Student.findByIdAndUpdate(
    id,
    { $set },
    { new: true, runValidators: true }
  );
  if (!updated) return res.status(404).json({ message: "Student not found" });
  res.json(updated);
});
module.exports = {
  getStudentPassing,
  getStudentTor,
  searchStudent,
  findStudent,
  searchPrograms,
  updateStudent,
};
