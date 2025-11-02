// backend/controllers/web/studentAdminController.js
const asyncHandler = require("express-async-handler");
const cloudinary = require("../../utils/cloudinary");
const Student = require("../../models/students/studentModel");
const Curriculum = require("../../models/students/Curriculum");
const { generateRandomGradesForCurriculum, generateStudentNumber } = require("../../lib/createStudent");

async function uploadDataUriToCloudinary(dataUri, folder = "students_profiles") {
  // Accepts a data URI (data:image/*;base64,...) and uploads to Cloudinary
  // If you also want to support raw file uploads, add a multer route later.
  if (!/^data:image\//i.test(String(dataUri || ""))) return null;
  const res = await cloudinary.uploader.upload(dataUri, { folder });
  return res?.secure_url || null;
}

/**
 * POST /api/web/students
 * Auth: admin/superadmin
 * Body:
 *  {
 *    fullName: string,
 *    studentNumber?: string,
 *    program?: string,            // optional if curriculumId provided
 *    curriculumId?: string,       // preferred
 *    dateGraduated?: string|date,
 *    photoDataUrl?: string        // optional data URI
 *  }
 * Creates a Student_Profiles document with random grades for that curriculum.
 */
exports.createStudent = asyncHandler(async (req, res) => {
  const {
    fullName,
    studentNumber,
    program,
    curriculumId,
    dateGraduated,
    photoDataUrl,
  } = req.body || {};

  if (!fullName) {
    res.status(400); throw new Error("fullName is required");
  }

  // Resolve curriculum
  let curriculum = null;
  if (curriculumId) {
    curriculum = await Curriculum.findById(curriculumId);
    if (!curriculum) { res.status(404); throw new Error("Curriculum not found"); }
  } else if (program) {
    curriculum = await Curriculum.findOne({ program: String(program).toUpperCase() }).sort({ createdAt: -1 });
    if (!curriculum) { res.status(404); throw new Error("No curriculum found for that program"); }
  } else {
    res.status(400); throw new Error("Provide curriculumId or program");
  }

  // Student number
  const sn = studentNumber && String(studentNumber).trim()
    ? String(studentNumber).trim()
    : generateStudentNumber();

  // Uniqueness check
  const exists = await Student.findOne({ studentNumber: sn });
  if (exists) { res.status(409); throw new Error("studentNumber already exists"); }

  // Random grades based on curriculum
  const { subjects, gwa } = generateRandomGradesForCurriculum(curriculum);
  if (!subjects.length) {
    res.status(400); throw new Error("Curriculum has no valid subjects");
  }

  // Optional image upload
  let photoUrl = null;
  if (photoDataUrl) {
    try {
      photoUrl = await uploadDataUriToCloudinary(photoDataUrl);
    } catch (e) {
      // not fatal—still allow creation without photo
      console.warn("Cloudinary upload failed:", e?.message || e);
    }
  }

  const student = await Student.create({
    studentNumber: sn,
    fullName,
    program: curriculum.program,
    dateGraduated: dateGraduated ? new Date(dateGraduated) : null,
    gwa,
    honor: "",
    curriculum: curriculum._id,
    subjects,
    photoUrl: photoUrl || null,
  });

  return res.status(201).json({ student });
});
