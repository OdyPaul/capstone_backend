// controllers/mobile/verificationController.js
const { isValidObjectId } = require("mongoose");

const VerificationRequest = require("../../models/mobile/verificationRequestModel");
const Image = require("../../models/mobile/imageModel");
const User = require("../../models/common/userModel");
const Student = require("../../models/students/studentModel"); // still here if other code needs it
const StudentData = require("../../models/students/studentDataModel");
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

function parseJsonMaybe(val, label) {
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    const err = new Error(`${label} must be a JSON object`);
    err.statusCode = 400;
    throw err;
  }
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

function yearRange(y) {
  const n = Number(y);
  if (!n || Number.isNaN(n)) return null;
  const start = new Date(n, 0, 1, 0, 0, 0, 0);
  const end = new Date(n, 11, 31, 23, 59, 59, 999);
  return { start, end };
}


/* ============================================================
   STUDENT: AUTO-MATCH STUDENT_DATA & LINK TO USER
   (new mobile flow: no admin approval needed)
   ============================================================ */
exports.autoMatchStudentData = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user._id;

    const {
      firstName,
      middleInitial,
      lastName,
      extName,
      gender,
      birthDate,
      admissionYear,
      graduationYear,
      program,
    } = req.body || {};

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

    // Names (case-insensitive exact)
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
    if (middleInitial) {
      const mi = String(middleInitial).trim().charAt(0);
      if (mi) {
        filter.middleName = {
          $regex: new RegExp("^" + escapeRegex(mi), "i"),
        };
      }
    }
    if (extName) {
      filter.extName = {
        $regex: new RegExp(
          "^" + escapeRegex(String(extName).trim()) + "$",
          "i"
        ),
      };
    }

    // Gender (simple case-insensitive match)
    if (gender) {
      filter.gender = {
        $regex: new RegExp(
          "^" + escapeRegex(String(gender).trim()),
          "i"
        ),
      };
    }

    // Program (exact string from Curriculum/program search)
    if (program) {
      filter.program = String(program).trim();
    }

    // Date of birth: same calendar day
    const dobRange = dayRange(birthDate);
    if (dobRange) {
      filter.dateOfBirth = { $gte: dobRange.start, $lte: dobRange.end };
    }

    // Admission / graduation years
    const admitRange = yearRange(admissionYear);
    if (admitRange) {
      filter.dateAdmitted = { $gte: admitRange.start, $lte: admitRange.end };
    }

    const gradRange = yearRange(graduationYear);
    if (gradRange) {
      filter.dateGraduated = { $gte: gradRange.start, $lte: gradRange.end };
    }

    // Find matching student(s)
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
    });
  } catch (err) {
    console.error(
      "autoMatchStudentData error:",
      err?.message,
      err?.stack
    );
    return res.status(500).json({
      message: err.message || "Failed to auto-match student record",
    });
  }
};

/* ============================================================
   ADMIN: QUEUE VERIFY
   ============================================================ */
exports.verifyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { studentId } = req.body || {};

    if (!isValidObjectId(id))
      return res.status(400).json({ message: "Invalid id" });
    if (studentId && !isValidObjectId(studentId))
      return res.status(400).json({ message: "Invalid studentId" });

    const vr = await VerificationRequest.findById(id).select(
      "_id status user"
    );

    if (!vr)
      return res.status(404).json({ message: "Request not found" });

    if (vr.status !== "pending") {
      return res
        .status(409)
        .json({ message: `Request is ${vr.status}, not pending` });
    }

    await enqueueVerify({
      requestId: id,
      studentId: studentId || null,
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
    });

    emitVerificationAudit({
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
      event: "verification.queued",
      recipients: [String(vr.user)],
      targetId: vr._id,
      title: "Verification in progress",
      body: "An admin has started reviewing your request.",
      extra: { status: "in_review" },
    });

    return res
      .status(202)
      .json({ queued: true, action: "verify", requestId: id });
  } catch (err) {
    console.error("verifyRequest error:", err?.message, err?.stack);
    return res
      .status(500)
      .json({ message: err.message || "Failed to queue verify" });
  }
};

/* ============================================================
   ADMIN: QUEUE REJECTION
   ============================================================ */
exports.rejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!isValidObjectId(id))
      return res.status(400).json({ message: "Invalid id" });

    const vr = await VerificationRequest.findById(id).select(
      "_id status user"
    );
    if (!vr)
      return res.status(404).json({ message: "Request not found" });

    if (vr.status !== "pending") {
      return res
        .status(409)
        .json({ message: `Request is ${vr.status}, not pending` });
    }

    await enqueueReject({
      requestId: id,
      reason: String(reason || "").slice(0, 240),
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
    });

    emitVerificationAudit({
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
      event: "verification.rejection_queued",
      recipients: [String(vr.user)],
      targetId: vr._id,
      title: "Verification update",
      body: "Your verification is being reviewed for rejection.",
      extra: { status: "pending_rejection", reason },
    });

    return res
      .status(202)
      .json({ queued: true, action: "reject", requestId: id });
  } catch (err) {
    console.error("rejectRequest error:", err?.message, err?.stack);
    return res
      .status(500)
      .json({ message: err.message || "Failed to queue reject" });
  }
};

/* ============================================================
   STUDENT: GET OWN REQUESTS
   ============================================================ */
exports.getMyVerificationRequests = async (req, res) => {
  try {
    const pops = buildPopulateList({ withImages: true });

    let q = VerificationRequest.find({
      user: req.user._id,
    }).sort({ createdAt: -1 });

    pops.forEach((p) => (q = q.populate(p)));

    const requests = await q.lean();
    res.json(requests);
  } catch (err) {
    console.error(
      "getMyVerificationRequests error:",
      err?.message,
      err?.stack
    );
    res
      .status(500)
      .json({ message: "Failed to fetch your verification requests" });
  }
};

/* ============================================================
   ADMIN: LIST REQUESTS
   ============================================================ */
exports.getVerificationRequests = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = "all",
      q = "",
      from = "",
      to = "",
      includeImages = "0",
    } = req.query;

    const pg = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));

    const filter = {};
    if (status && status !== "all") filter.status = status;

    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { "personal.fullName": { $regex: safe, $options: "i" } },
      ]; // DID removed
    }

    const fromDate = from ? safeDate(from) : null;
    const toDate = to ? safeDate(to) : null;

    if (from && !fromDate)
      return res.status(400).json({ message: "Invalid 'from' date" });
    if (to && !toDate)
      return res.status(400).json({ message: "Invalid 'to' date" });

    if (fromDate)
      filter.createdAt = { ...(filter.createdAt || {}), $gte: fromDate };
    if (toDate)
      filter.createdAt = { ...(filter.createdAt || {}), $lte: toDate };

    const pops = buildPopulateList({
      withImages: toBool(includeImages),
    });

    let qDoc = VerificationRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((pg - 1) * lim)
      .limit(lim);

    pops.forEach((p) => (qDoc = qDoc.populate(p)));

    const [items, total] = await Promise.all([
      qDoc.lean(),
      VerificationRequest.countDocuments(filter),
    ]);

    res.json({ items, total, page: pg, limit: lim });
  } catch (err) {
    console.error("getVerificationRequests error:", err?.message, err?.stack);
    res
      .status(500)
      .json({ message: "Failed to fetch verification requests" });
  }
};

/* ============================================================
   ADMIN: GET SINGLE REQUEST
   ============================================================ */
exports.getVerificationRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id))
      return res.status(400).json({ message: "Invalid id" });

    const pops = buildPopulateList({ withImages: true });

    let q = VerificationRequest.findById(id);
    pops.forEach((p) => (q = q.populate(p)));

    const request = await q.lean();

    if (!request)
      return res.status(404).json({ message: "Request not found" });

    res.json(request);
  } catch (err) {
    console.error(
      "getVerificationRequestById error:",
      err?.message,
      err?.stack
    );
    res.status(500).json({ message: "Failed to fetch request" });
  }
};
