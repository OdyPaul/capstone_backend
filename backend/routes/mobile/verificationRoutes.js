// routes/mobile/verificationRoutes.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const verificationCtrl = require("../../controllers/mobile/verificationController");
const { protect, admin } = require("../../middleware/authMiddleware");
const { z, validate, objectId } = require("../../middleware/validate");
const requestLogger = require("../../middleware/requestLogger");

// ====== Schemas (sanitize/limit) ======
const personalSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(240),
  birthPlace: z.string().trim().min(1).max(120),
  birthDate: z.coerce.date(),
}).strict();

const educationSchema = z.object({
  highSchool: z.string().trim().min(1).max(160),
  admissionDate: z.string().trim().max(20),
  graduationDate: z.string().trim().max(20),
}).strict();

const createBody = z.object({
  personal: personalSchema,
  education: educationSchema,
  selfieImageId: objectId(),
  idImageId: objectId(),
  did: z.string().trim().min(3).max(200),
}).strip();

const verifyBody = z.object({
  studentId: objectId().optional(),
}).strip();

const rejectBody = z.object({
  reason: z.string().trim().max(240).optional(),
}).strip();

const idParam = z.object({ id: objectId() }).strict();

// ====== Rate limits ======
const studentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const adminActLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// ====== STUDENT ======
router.post(
  "/",
  protect,
  studentLimiter,
  validate({ body: createBody }),
  requestLogger("mobile.verify.create", { db: "auth" }),
  verificationCtrl.createVerificationRequest
);

router.get(
  "/mine",
  protect,
  verificationCtrl.getMyVerificationRequests
);

// ====== ADMIN ======
router.get(
  "/",
  protect, admin,
  verificationCtrl.getVerificationRequests
);

router.get(
  "/:id",
  protect, admin,
  validate({ params: idParam }),
  requestLogger("mobile.verify.admin.get", { db: "auth" }),
  verificationCtrl.getVerificationRequestById
);

router.post(
  "/:id/verify",
  protect, admin,
  adminActLimiter,
  validate({ params: idParam, body: verifyBody }),
  requestLogger("mobile.verify.admin.verify", { db: "auth" }),
  verificationCtrl.verifyRequest
);

router.post(
  "/:id/reject",
  protect, admin,
  adminActLimiter,
  validate({ params: idParam, body: rejectBody }),
  requestLogger("mobile.verify.admin.reject", { db: "auth" }),
  verificationCtrl.rejectRequest
);

module.exports = router;
