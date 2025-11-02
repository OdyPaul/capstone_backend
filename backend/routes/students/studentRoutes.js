// backend/routes/web/studentsRoutes.js
const express = require("express");
const router = express.Router();

const {
  getStudentPassing,
  getStudentTor,
  searchStudent,
  findStudent,
} = require("../../controllers/web/studentController");

const { createStudent } = require("../../controllers/web/createStudentController");

const { protect, allowRoles } = require("../../middleware/authMiddleware");
const { rateLimitRedis } = require("../../middleware/rateLimitRedis");
const { z, validate } = require("../../middleware/validate");

// ---------- Shared query rules ----------
const queryCommon = {
  q: z.string().trim().max(64).optional(),
  college: z.string().trim().max(64).optional(),
  programs: z.union([
    z.string().trim().max(64),
    z.array(z.string().trim().max(64)).max(20)
  ]).optional(),
};

const passingSchema = {
  query: z.object({
    ...queryCommon,
    year: z.union([z.literal("All"), z.coerce.number().int().min(1900).max(2100)]).optional(),
  }).strip(),
};

const searchSchema = {
  query: z.object({ ...queryCommon }).strip(),
};

// ---------- Create student schema (admin/superadmin) ----------
const createSchema = {
  body: z.object({
    fullName: z.string().trim().min(2).max(200),
    studentNumber: z.string().trim().max(50).optional(),
    program: z.string().trim().max(200).optional(),
    curriculumId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
    dateGraduated: z.any().optional(),
    photoDataUrl: z.string().startsWith("data:image/").optional().nullable(),
  }).strip(),
};

// ---------- Sub-router for /student/* GETs ----------
const student = express.Router();

student.get(
  "/passing",
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

student.get(
  "/search",
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

student.get("/:id/tor", protect, getStudentTor);
student.get("/:id", protect, findStudent);

// Mount /student/* endpoints
router.use("/student", student);

// ---------- POST /students (create) ----------
router.post(
  "/students",
  protect,
  allowRoles("admin", "superadmin"),
  validate(createSchema),
  createStudent
);

module.exports = router;
