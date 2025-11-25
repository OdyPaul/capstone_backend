// backend/routes/web/studentsRoutes.js
const express = require("express");
const router = express.Router();

const {
  getStudentPassing,
  getStudentTor,
  searchStudent,
  findStudent,
  searchPrograms,
  updateStudent,
} = require("../../controllers/web/studentController");

const { createStudent } = require("../../controllers/web/createStudentController");

const { protect, allowRoles } = require("../../middleware/authMiddleware");
const { rateLimitRedis } = require("../../middleware/rateLimitRedis");
const { z, validate } = require("../../middleware/validate");

// ---------- Shared query rules ----------
const queryCommon = {
  q: z.string().trim().max(64).optional(),
  college: z.string().trim().max(64).optional(),
  programs: z
    .union([
      z.string().trim().max(64),
      z.array(z.string().trim().max(64)).max(20),
    ])
    .optional(),
};

const passingSchema = {
  query: z
    .object({
      ...queryCommon,
      year: z
        .union([
          z.literal("All"),
          z.coerce.number().int().min(1900).max(2100),
        ])
        .optional(),
    })
    .strip(),
};

const searchSchema = {
  query: z.object({ ...queryCommon }).strip(),
};

// 🔎 Programs search schema
const programSearchSchema = {
  query: z
    .object({
      q: z.string().trim().max(128).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    })
    .strip(),
};

// ---------- Create student schema ----------
const createSchema = {
  body: z
    .object({
      fullName: z.string().trim().min(2).max(200),
      studentNumber: z.string().trim().max(50).optional(),
      program: z.string().trim().max(200).optional(),
      curriculumId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
      dateGraduated: z.any().optional(),
      photoDataUrl: z
        .string()
        .startsWith("data:image/")
        .optional()
        .nullable(),
    })
    .strip(),
};

// ---------- Update student schema ----------
const updateSchema = {
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  }),
  body: z
    .object({
      fullName: z.string().trim().max(200).optional(),
      extensionName: z.string().trim().max(100).optional(),

      gender: z
        .preprocess(
          (v) => (typeof v === "string" ? v.toLowerCase().trim() : v),
          z.enum(["male", "female", "other"])
        )
        .optional(),

      address: z.string().trim().max(500).optional(),
      placeOfBirth: z.string().trim().max(200).optional(),
      dateOfBirth: z.any().optional(),
      highSchool: z.string().trim().max(200).optional(),
      entranceCredentials: z.string().trim().max(200).optional(),
      program: z.string().trim().max(200).optional(),
      major: z.string().trim().max(200).optional(),
      dateAdmission: z.any().optional(),
      dateGraduated: z.any().optional(),
      honor: z.string().trim().max(200).optional(),
      photoDataUrl: z
        .string()
        .startsWith("data:image/")
        .optional()
        .nullable(),
      curriculumId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
      regenSubjects: z.coerce.boolean().optional(), // ignored in controller
    })
    .strip(),
};

// ---------------------------------------------------------------------------
// EXPLICIT ROUTES – final paths under /api/web will be:
//
//   GET    /api/web/students/passing
//   GET    /api/web/students/search
//   GET    /api/web/students/:id/tor
//   GET    /api/web/students/:id
//   GET    /api/web/programs
//   POST   /api/web/students
//   PATCH  /api/web/students/:id
// ---------------------------------------------------------------------------

// Passing students
router.get(
  "/students/passing",
  protect,
  validate(passingSchema),
  rateLimitRedis({
    prefix: "rl:student:passing",
    windowMs: 60_000,
    max: 60,
    keyFn: (req) => req.user?._id?.toString() || req.ip,
  }),
  getStudentPassing
);

// Search students
router.get(
  "/students/search",
  protect,
  validate(searchSchema),
  rateLimitRedis({
    prefix: "rl:student:search",
    windowMs: 60_000,
    max: 30,
    keyFn: (req) => req.user?._id?.toString() || req.ip,
  }),
  searchStudent
);

// TOR
router.get("/students/:id/tor", protect, getStudentTor);

// Detail
router.get("/students/:id", protect, findStudent);

// Programs search
router.get(
  "/programs",
  protect,
  validate(programSearchSchema),
  rateLimitRedis({
    prefix: "rl:programs:search",
    windowMs: 60_000,
    max: 60,
    keyFn: (req) => req.user?._id?.toString() || req.ip,
  }),
  searchPrograms
);

// Create student
router.post(
  "/students",
  protect,
  allowRoles("admin", "superadmin"),
  validate(createSchema),
  createStudent
);

// Update student
router.patch(
  "/students/:id",
  protect,
  allowRoles("admin", "superadmin"),
  validate(updateSchema),
  updateStudent
);

module.exports = router;
