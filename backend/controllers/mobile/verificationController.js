// controllers/mobile/verificationController.js
const { isValidObjectId } = require("mongoose");

const VerificationRequest = require("../../models/mobile/verificationRequestModel");
const Image = require("../../models/mobile/imageModel");
const User = require("../../models/common/userModel");
const Student = require("../../models/students/studentModel"); // still here if other code needs it
const StudentData = require("../../models/students/studentDataModel");
const Grade = require("../../models/students/gradeModel");
const { enqueueVerify, enqueueReject } = require("../../queues/verification.queue");

/* ---------- Audit Helpers ---------- */
const { getAuthConn } = require("../../config/db");
const AuditLogSchema = require("../../models/common/auditLog.schema");

let AuditLogAuth = null;
function getAuditLogAuth() {
  try {
    if (!AuditLogAuth) {
      const conn = getAuthConn();
      if (!conn) return null;
      AuditLogAuth =
        conn.models.AuditLog || conn.model("AuditLog", AuditLogSchema);
    }
    return AuditLogAuth;
  } catch {
    return null;
  }
}

async function emitVerificationAudit({
  actorId,
  actorRole,
  event,
  recipients = [],
  targetId,
  title,
  body,
  extra = {},
}) {
  try {
    const AuditLog = getAuditLogAuth();
    if (!AuditLog) return;

    const doc = {
      ts: new Date(),
      actorId: actorId || null,
      actorRole: actorRole || null,
      ip: null,
      ua: "",
      method: "INTERNAL",
      path: "/verification-request",
      status: 200,
      latencyMs: 0,
      routeTag: "verification.activity",
      query: {},
      params: {},
      bodyKeys: [],
      draftId: null,
      paymentId: null,
      vcId: null,
      meta: {
        event,
        recipients,
        targetKind: "verification",
        targetId: targetId || null,
        title: title || null,
        body: body || null,
        ...extra,
      },
    };

    await AuditLog.create(doc);
  } catch {
    // ignore audit errors
  }
}

/* ---------- Helpers ---------- */
function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string")
    return ["1", "true", "yes", "y"].includes(v.toLowerCase());
  return false;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDate(d) {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function canPopulateModel(modelName) {
  try {
    const models = VerificationRequest?.db?.models || {};
    return !!models[modelName];
  } catch {
    return false;
  }
}

function buildPopulateList({ withImages = false } = {}) {
  const pops = [];

  if (canPopulateModel("User")) {
    pops.push({
      path: "user",
      select: "email username fullName role",
    });
  }

  if (canPopulateModel("Student_Profiles")) {
    pops.push({
      path: "student",
      select: "fullName studentNumber program",
    });
  }

  if (withImages && canPopulateModel("Image")) {
    pops.push({ path: "selfieImage", select: "url" });
    pops.push({ path: "idImage", select: "url" });
  }

  return pops;
}

function dayRange(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const start = new Date(
    dt.getFullYear(),
    dt.getMonth(),
    dt.getDate(),
    0,
    0,
    0,
    0
  );
  const end = new Date(
    dt.getFullYear(),
    dt.getMonth(),
    dt.getDate(),
    23,
    59,
    59,
    999
  );
  return { start, end };
}

/* ============================================================
   NEW FLOW: AUTO-MATCH Student_Data + Grades
   - No admin approval
   - Admission / graduation: matched by YEAR ONLY
   - extName is accepted but NOT used for matching
   ============================================================ */
exports.autoMatchStudent = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user._id;

    const {
      firstName,
      middleInitial,
      lastName,
      extName, // optional, NOT used as filter
      gender,
      birthDate,
      admissionYear,
      graduationYear,
      program,
    } = req.body || {};

    // Basic safety; zod already validated in routes
    if (
      !firstName ||
      !lastName ||
      !birthDate ||
      !admissionYear ||
      !graduationYear ||
      !program
    ) {
      return res
        .status(400)
        .json({ message: "Missing required verification fields" });
    }

    const filter = {};

    // Names (case-insensitive exact-ish)
    if (firstName) {
      filter.firstName = {
        $regex: new RegExp(
          "^" + escapeRegex(String(firstName).trim()) + "$",
          "i"
        ),
      };
    }
    if (lastName) {
      filter.lastName = {
        $regex: new RegExp(
          "^" + escapeRegex(String(lastName).trim()) + "$",
          "i"
        ),
      };
    }

    // middleInitial → match beginning of middleName (e.g. "M" matches "Marie")
    if (middleInitial) {
      const mi = String(middleInitial).trim().charAt(0);
      if (mi) {
        filter.middleName = {
          $regex: new RegExp("^" + escapeRegex(mi), "i"),
        };
      }
    }

    // ❗ extName is OPTIONAL and NOT used for matching to avoid mismatches
    // if (extName) { ... } // ← intentionally not used

    // Gender (simple case-insensitive match)
    if (gender) {
      filter.gender = {
        $regex: new RegExp(
          "^" + escapeRegex(String(gender).trim()),
          "i"
        ),
      };
    }

    // Program (exact from Curriculum/program search)
    if (program) {
      filter.program = String(program).trim();
    }

    // Date of birth: exact calendar day (00:00–23:59 of that date)
    const dobRange = dayRange(birthDate);
    if (dobRange) {
      filter.dateOfBirth = { $gte: dobRange.start, $lte: dobRange.end };
    }

    // Admission / graduation year ⇒ YEAR-ONLY match using $year
    const exprs = [];
    const admYear = parseInt(admissionYear, 10);
    const gradYear = parseInt(graduationYear, 10);

    if (admYear) {
      exprs.push({
        $eq: [{ $year: "$dateAdmitted" }, admYear],
      });
    }

    if (gradYear) {
      exprs.push({
        $eq: [{ $year: "$dateGraduated" }, gradYear],
      });
    }

    if (exprs.length === 1) {
      filter.$expr = exprs[0];
    } else if (exprs.length > 1) {
      filter.$expr = { $and: exprs };
    }

    // Find matching student(s) from Student_Data
    const candidates = await StudentData.find(filter).limit(3).lean();

    if (!candidates.length) {
      return res
        .status(404)
        .json({ message: "No matching student record found" });
    }

    if (candidates.length > 1) {
      return res.status(409).json({
        message:
          "Multiple student records match these details. Please contact the registrar for assistance.",
      });
    }

    const student = candidates[0];

    // Check if this student record is already linked to another user
    if (student.userId && String(student.userId) !== String(userId)) {
      return res.status(409).json({
        message: "This student record is already linked to another account.",
      });
    }

    // Check if this user already linked to a different student record
    const existing = await StudentData.findOne({ userId }).lean();
    if (existing && String(existing._id) !== String(student._id)) {
      return res.status(409).json({
        message:
          "Your account is already linked to a different student record.",
      });
    }

    // Link Student_Data to user
    const updated = await StudentData.findByIdAndUpdate(
      student._id,
      { userId },
      { new: true }
    ).lean();

    // Load grades referencing this Student_Data (reference only)
    let grades = [];
    try {
      grades = await Grade.find({ student: updated._id })
        .select(
          "curriculum yearLevel semester subjectCode subjectTitle units schoolYear termName finalGrade remarks"
        )
        .lean();
    } catch (e) {
      console.error(
        "autoMatchStudent: failed to load grades:",
        e?.message
      );
      // don't block linking if grades lookup fails
    }

    // Optionally sync user's fullName
    try {
      const fullName =
        updated.fullName ||
        `${updated.lastName}, ${updated.firstName}${
          updated.middleName ? " " + updated.middleName.charAt(0) + "." : ""
        }`;

      await User.findByIdAndUpdate(userId, { fullName }).catch(() => {});
    } catch {
      // ignore user update errors
    }

    // Audit log for auto-verify
    emitVerificationAudit({
      actorId: userId,
      actorRole: req.user.role || null,
      event: "verification.auto_matched",
      recipients: [String(userId)],
      targetId: updated._id,
      title: "Student record linked automatically",
      body: "Your account was automatically matched to your student record.",
      extra: { studentNumber: updated.studentNumber },
    });

    return res.json({
      success: true,
      student: {
        _id: updated._id,
        studentNumber: updated.studentNumber,
        fullName: updated.fullName,
        program: updated.program,
        dateAdmitted: updated.dateAdmitted,
        dateGraduated: updated.dateGraduated,
      },
      grades,
    });
  } catch (err) {
    console.error("autoMatchStudent error:", err?.message, err?.stack);
    return res.status(500).json({
      message: err.message || "Failed to auto-match student record",
    });
  }
};

/* ============================================================
   LEGACY FLOW (selfie + ID + VerificationRequest)
   - Commented out so only autoMatch is used now
   - Keep here for reference / possible future use
   ============================================================ */

/*
exports.createVerificationRequest = async (req, res) => {
  try {
    let { personal, education, selfieImageId, idImageId } = req.body || {};

    if (!personal || !education) {
      return res
        .status(400)
        .json({ message: "Personal and education info required" });
    }

    if (!selfieImageId || !idImageId) {
      return res
        .status(400)
        .json({ message: "Selfie and ID images are required" });
    }

    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    personal = parseJsonMaybe(personal, "personal");
    education = parseJsonMaybe(education, "education");

    const verification = await VerificationRequest.create({
      user: req.user._id,
      personal,
      education,
      selfieImage: selfieImageId,
      idImage: idImageId,
      status: "pending",
    });

    try {
      await Promise.all([
        Image.findByIdAndUpdate(selfieImageId, {
          ownerRequest: verification._id,
        }).catch(() => {}),
        Image.findByIdAndUpdate(idImageId, {
          ownerRequest: verification._id,
        }).catch(() => {}),
      ]);
    } catch {}

    emitVerificationAudit({
      actorId: req.user._id,
      actorRole: req.user.role || null,
      event: "verification.requested",
      recipients: [String(req.user._id)],
      targetId: verification._id,
      title: "Verification request submitted",
      body: "We received your verification details.",
      extra: { status: "pending", selfieImageId, idImageId },
    });

    return res.status(201).json(verification);
  } catch (err) {
    console.error("createVerificationRequest error:", err?.message, err?.stack);
    return res
      .status(err.statusCode || 500)
      .json({ message: err.message || "Failed to submit verification" });
  }
};

exports.verifyRequest = async (req, res) => { ... };

exports.rejectRequest = async (req, res) => { ... };

exports.getMyVerificationRequests = async (req, res) => { ... };

exports.getVerificationRequests = async (req, res) => { ... };

exports.getVerificationRequestById = async (req, res) => { ... };
*/
