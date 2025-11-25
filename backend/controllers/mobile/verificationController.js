// controllers/mobile/verificationController.js
const { isValidObjectId } = require("mongoose");

const VerificationRequest = require("../../models/mobile/verificationRequestModel");
const Image = require("../../models/mobile/imageModel");
const User = require("../../models/common/userModel");
const StudentData = require("../../models/testing/studentDataModel");
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
  } catch {}
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

  // If VerificationRequest.student is ref: "Student_Data" on the same connection:
  if (canPopulateModel("Student_Data")) {
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

/* ============================================================
   STUDENT: CREATE VERIFICATION REQUEST
   ============================================================ */
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

/* ============================================================
   ADMIN: VERIFY REQUEST (link & mark verified)
   ============================================================ */
exports.verifyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { studentId } = req.body || {};

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    if (studentId && !isValidObjectId(studentId)) {
      return res.status(400).json({ message: "Invalid studentId" });
    }

    const vr = await VerificationRequest.findById(id).select(
      "_id status user student"
    );

    if (!vr) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (vr.status !== "pending") {
      return res
        .status(409)
        .json({ message: `Request is ${vr.status}, not pending` });
    }

    // If a studentId is provided, link MIS record -> request.user
    if (studentId) {
      const student = await StudentData.findById(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const userIdStr = vr.user.toString();

      // Prevent stealing another student's record
      if (student.userId && student.userId.toString() !== userIdStr) {
        return res
          .status(409)
          .json({ message: "Student record already linked to another user" });
      }

      student.userId = vr.user;
      await student.save();

      // If VerificationRequest has a student field pointing to same conn:
      // vr.student = student._id;
    }

    // Mark the user as verified
    await User.updateOne(
      { _id: vr.user },
      { $set: { verified: "verified" } }
    );

    // Mark the request itself as verified
    vr.status = "verified";
    vr.verifiedAt = new Date();
    vr.verifiedBy = req.user?._id || null;
    await vr.save();

    // Optional: enqueue for notifications / async side-effects
    await enqueueVerify({
      requestId: id,
      studentId: studentId || null,
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
    });

    emitVerificationAudit({
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
      event: "verification.verified",
      recipients: [String(vr.user)],
      targetId: vr._id,
      title: "Verification approved",
      body: "Your account has been verified.",
      extra: { status: "verified", studentId: studentId || null },
    });

    return res.status(200).json({
      queued: false, // synchronous verify
      action: "verify",
      requestId: id,
      studentId: studentId || null,
    });
  } catch (err) {
    console.error("verifyRequest error:", err?.message, err?.stack);
    return res
      .status(500)
      .json({ message: err.message || "Failed to verify request" });
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
      ];
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
