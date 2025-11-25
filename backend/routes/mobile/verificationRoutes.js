// routes/mobile/verificationRoutes.js
const express = require("express");
const router = express.Router();

const verificationCtrl = require("../../controllers/mobile/verificationController");
const { protect, admin } = require("../../middleware/authMiddleware");
const { z, validate, objectId } = require("../../middleware/validate");
const requestLogger = require("../../middleware/requestLogger");
const { rateLimitRedis } = require("../../middleware/rateLimitRedis");

// ---------- NEW: Auto-match schema (mobile) ----------
const autoMatchSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120),
    middleInitial: z
      .string()
      .trim()
      .max(1)
      .optional()
      .nullable(),
    lastName: z.string().trim().min(1).max(120),
    extName: z
      .string()
      .trim()
      .max(32)
      .optional()
      .nullable(), // optional, NOT used in filter
    gender: z.string().trim().min(1).max(32),
    birthDate: z.coerce.date(),
    admissionYear: z.coerce.number().int().min(1900).max(2100),
    graduationYear: z.coerce.number().int().min(1900).max(2100),
    program: z.string().trim().min(1).max(160),
    // programLabel can be sent by app but not needed here; ignored
  })
  .strip();

// ---------- Rate limit for auto-match ----------
const rlStudentAutoMatch = rateLimitRedis({
  prefix: "rl:vr:auto",
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 6,
  keyFn: (req) => req.user?._id || req.ip,
});

// ---------- NEW: STUDENT AUTO-MATCH ENDPOINT ----------
router.post(
  "/auto-match",
  protect,
  rlStudentAutoMatch,
  validate({ body: autoMatchSchema }),
  requestLogger("verification.auto_match", { db: "auth" }),
  verificationCtrl.autoMatchStudent
);

// ===================================================================
// LEGACY ROUTES (selfie + ID + VerificationRequest)
// Commented out so only auto-match is used now.
// Kept here for reference / possible future revert.
// ===================================================================

/*
const createSchema = z
  .object({
    personal: z
      .object({
        fullName: z.string().trim().min(1).max(120),
        address: z.string().trim().min(1).max(240),
        birthPlace: z.string().trim().min(1).max(120),
        birthDate: z.coerce.date(),
      })
      .strip(),
    education: z
      .object({
        highSchool: z.string().trim().min(1).max(160),
        admissionDate: z.string().trim().max(32),
        graduationDate: z.string().trim().max(32),
      })
      .strip(),
    selfieImageId: objectId(),
    idImageId: objectId(),
  })
  .strip();

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    status: z.enum(["all", "pending", "verified", "rejected"]).optional(),
    q: z.string().trim().max(120).optional(),
    from: z.string().trim().max(30).optional(),
    to: z.string().trim().max(30).optional(),
    includeImages: z.enum(["0", "1", "true", "false"]).optional(),
  })
  .strip();

const idParam = z.object({ id: objectId() }).strict();
const verifyBody = z.object({ studentId: objectId().optional() }).strip();
const rejectBody = z
  .object({ reason: z.string().trim().max(240).optional() })
  .strip();

const rlStudentCreate = rateLimitRedis({
  prefix: "rl:vr:create",
  windowMs: 10 * 60 * 1000,
  max: 4,
  keyFn: (req) => req.user?._id || req.ip,
});

const rlStudentMine = rateLimitRedis({
  prefix: "rl:vr:mine",
  windowMs: 60 * 1000,
  max: 30,
  keyFn: (req) => req.user?._id || req.ip,
});

const rlAdminList = rateLimitRedis({
  prefix: "rl:vr:list",
  windowMs: 60 * 1000,
  max: 60,
  keyFn: (req) => req.user?._id || req.ip,
});

const rlAdminGet = rateLimitRedis({
  prefix: "rl:vr:get",
  windowMs: 60 * 1000,
  max: 120,
  keyFn: (req) => req.user?._id || req.ip,
});

const rlAdminAction = rateLimitRedis({
  prefix: "rl:vr:act",
  windowMs: 60 * 1000,
  max: 30,
  keyFn: (req) => req.user?._id || req.ip,
});

// ---------- LEGACY STUDENT ----------
router.post(
  "/",
  protect,
  rlStudentCreate,
  validate({ body: createSchema }),
  requestLogger("verification.create", { db: "auth" }),
  verificationCtrl.createVerificationRequest
);

router.get(
  "/mine",
  protect,
  rlStudentMine,
  requestLogger("verification.mine", { db: "auth" }),
  verificationCtrl.getMyVerificationRequests
);

// ---------- LEGACY ADMIN ----------
router.get(
  "/",
  protect,
  admin,
  rlAdminList,
  validate({ query: listSchema }),
  requestLogger("verification.admin.list", { db: "auth" }),
  verificationCtrl.getVerificationRequests
);

router.get(
  "/:id",
  protect,
  admin,
  rlAdminGet,
  validate({ params: idParam }),
  requestLogger("verification.admin.get", { db: "auth" }),
  verificationCtrl.getVerificationRequestById
);

router.post(
  "/:id/verify",
  protect,
  admin,
  rlAdminAction,
  validate({ params: idParam, body: verifyBody }),
  requestLogger("verification.admin.verify", { db: "auth" }),
  verificationCtrl.verifyRequest
);

router.post(
  "/:id/reject",
  protect,
  admin,
  rlAdminAction,
  validate({ params: idParam, body: rejectBody }),
  requestLogger("verification.admin.reject", { db: "auth" }),
  verificationCtrl.rejectRequest
);
*/

module.exports = router;
