// controllers/mobile/verificationController.js
const { isValidObjectId } = require("mongoose");

const VerificationRequest = require("../../models/mobile/verificationRequestModel");
const Image = require("../../models/mobile/imageModel"); // may be on a different conn
const User = require("../../models/common/userModel");   // may be on a different conn
const Student = require("../../models/students/studentModel"); // may be on a different conn
const { enqueueVerify, enqueueReject } = require("../../queues/verification.queue");

/* ---------- 👇 minimal audit helpers (auth DB) ---------- */
const { getAuthConn } = require("../../config/db");
const AuditLogSchema = require("../../models/common/auditLog.schema");

let AuditLogAuth = null;
function getAuditLogAuth() {
  try {
    if (!AuditLogAuth) {
      const conn = getAuthConn();
      if (!conn) return null;
      AuditLogAuth = conn.models.AuditLog || conn.model("AuditLog", AuditLogSchema);
    }
    return AuditLogAuth;
  } catch {
    return null; // never break requests because of logging
  }
}

async function emitVerificationAudit({
  actorId,
  actorRole,
  event,            // e.g., 'verification.requested'
  recipients = [],  // array of ObjectId strings
  targetId,         // verification request _id
  title,
  body,
  extra = {},       // any additional meta fields
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
        event,                // canonical event key
        recipients,           // who should see this in Activity
        targetKind: "verification",
        targetId: targetId || null,
        title: title || null,
        body: body || null,
        ...extra,             // safe extras (e.g., current status)
      },
    };

    await AuditLog.create(doc);
  } catch {
    // swallow — audit must never affect normal flow
  }
}
/* ---------- 👆 minimal audit helpers (auth DB) ---------- */

// -------- Helpers --------
function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["1", "true", "yes", "y"].includes(v.toLowerCase());
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

/**
 * Some referenced models may live on a *different* Mongoose connection.
 * Populating across connections throws "MissingSchemaError".
 * We only populate if the model is registered on the SAME connection
 * as VerificationRequest.
 */
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
    pops.push({ path: "user", select: "email username fullName role" });
  }
  // NOTE: your schema uses ref: "Student_Profiles"
  if (canPopulateModel("Student_Profiles")) {
    pops.push({ path: "student", select: "fullName studentNumber program" });
  }
  if (withImages && canPopulateModel("Image")) {
    pops.push({ path: "selfieImage", select: "url" });
    pops.push({ path: "idImage", select: "url" });
  }
  return pops;
}

// ===== Student submits a verification request =====
// @route POST /api/verification-request
// @access Private (student)
exports.createVerificationRequest = async (req, res) => {
  try {
    let { personal, education, selfieImageId, idImageId, did } = req.body || {};

    if (!personal || !education) {
      return res.status(400).json({ message: "Personal and education info required" });
    }
    if (!selfieImageId || !idImageId) {
      return res.status(400).json({ message: "Selfie and ID images are required" });
    }
    if (!did) {
      return res.status(400).json({ message: "DID is required. Please link your wallet first." });
    }
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Parse JSON if sent as strings (from RN or form-data)
    personal = parseJsonMaybe(personal, "personal");
    education = parseJsonMaybe(education, "education");

    const verification = await VerificationRequest.create({
      user: req.user._id,
      personal,
      education,
      selfieImage: selfieImageId,
      idImage: idImageId,
      did,
      status: "pending",
    });

    // Link images back to the request (best-effort)
    try {
      await Promise.all([
        Image.findByIdAndUpdate(selfieImageId, { ownerRequest: verification._id }).catch(() => {}),
        Image.findByIdAndUpdate(idImageId, { ownerRequest: verification._id }).catch(() => {}),
      ]);
    } catch {
      // ignore linking failures; not fatal for creation
    }

    // 🔔 Emit Activity: verification.requested (recipient: the student)
    emitVerificationAudit({
      actorId: req.user._id,
      actorRole: req.user.role || null,
      event: "verification.requested",
      recipients: [String(req.user._id)],
      targetId: verification._id,
      title: "Verification request submitted",
      body: "We received your verification details. You'll be notified once reviewed.",
      extra: { status: "pending", selfieImageId, idImageId },
    });

    return res.status(201).json(verification);
  } catch (err) {
    if (err?.code === 11000 && (err?.keyPattern?.did || err?.keyValue?.did)) {
      return res.status(409).json({ message: "DID already used in another request" });
    }
    console.error("createVerificationRequest error:", err?.message, err?.stack);
    return res.status(err.statusCode || 500).json({
      message: err.message || "Failed to submit verification",
    });
  }
};

// ===== Admin: queue verify (optionally link to Student in worker) =====
// @route POST /api/verification-request/:id/verify
// @access Private (admin)
exports.verifyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { studentId } = req.body || {};

    if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });
    if (studentId && !isValidObjectId(studentId)) {
      return res.status(400).json({ message: "Invalid studentId" });
    }

    // Light existence check so we can fail fast (need user to notify)
    const vr = await VerificationRequest.findById(id).select("_id status user");
    if (!vr) return res.status(404).json({ message: "Request not found" });
    if (vr.status !== "pending") {
      return res.status(409).json({ message: `Request is ${vr.status}, not pending` });
    }

    await enqueueVerify({
      requestId: id,
      studentId: studentId || null,
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
    });

    // 🔔 Emit Activity: verification.queued (recipient: the student)
    emitVerificationAudit({
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
      event: "verification.queued",
      recipients: [String(vr.user)],
      targetId: vr._id,
      title: "Verification in progress",
      body: "An admin has started reviewing your verification request.",
      extra: { status: "in_review" },
    });

    return res
      .status(202)
      .json({ queued: true, action: "verify", requestId: id, studentId: studentId || null });
  } catch (err) {
    console.error("verifyRequest enqueue error:", err?.message, err?.stack);
    return res.status(500).json({ message: err.message || "Failed to queue verify" });
  }
};

// ===== Admin: queue reject =====
// @route POST /api/verification-request/:id/reject
// @access Private (admin)
exports.rejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    // Light existence check (need user to notify)
    const vr = await VerificationRequest.findById(id).select("_id status user");
    if (!vr) return res.status(404).json({ message: "Request not found" });
    if (vr.status !== "pending") {
      return res.status(409).json({ message: `Request is ${vr.status}, not pending` });
    }

    await enqueueReject({
      requestId: id,
      reason: String(reason || "").slice(0, 240),
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
    });

    // 🔔 Emit Activity: verification.rejection_queued (recipient: the student)
    emitVerificationAudit({
      actorId: req.user?._id || null,
      actorRole: req.user?.role || null,
      event: "verification.rejection_queued",
      recipients: [String(vr.user)],
      targetId: vr._id,
      title: "Verification update",
      body: "Your verification is queued for rejection review. You'll receive a final decision soon.",
      extra: { status: "pending_rejection", reason: reason ? String(reason).slice(0, 240) : undefined },
    });

    return res.status(202).json({ queued: true, action: "reject", requestId: id });
  } catch (err) {
    console.error("rejectRequest enqueue error:", err?.message, err?.stack);
    return res.status(500).json({ message: err.message || "Failed to queue reject" });
  }
};

// ===== Student: list own requests =====
// @route GET /api/verification-request/mine
// @access Private (student)
exports.getMyVerificationRequests = async (req, res) => {
  try {
    const pops = buildPopulateList({ withImages: true });

    let q = VerificationRequest.find({ user: req.user._id }).sort({ createdAt: -1 });
    pops.forEach((p) => (q = q.populate(p)));

    const requests = await q.lean();
    res.json(requests);
  } catch (err) {
    console.error("getMyVerificationRequests error:", err?.message, err?.stack);
    res.status(500).json({ message: "Failed to fetch your verification requests" });
  }
};

// ===== Admin: list requests (filters & pagination) =====
// @route GET /api/verification-request
// @access Private (admin)
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
        { did: { $regex: safe, $options: "i" } },
        { "personal.fullName": { $regex: safe, $options: "i" } },
      ];
    }

    const fromDate = from ? safeDate(from) : null;
    const toDate = to ? safeDate(to) : null;
    if (from && !fromDate) return res.status(400).json({ message: "Invalid 'from' date" });
    if (to && !toDate) return res.status(400).json({ message: "Invalid 'to' date" });
    if (fromDate) filter.createdAt = { ...(filter.createdAt || {}), $gte: fromDate };
    if (toDate) filter.createdAt = { ...(filter.createdAt || {}), $lte: toDate };

    const pops = buildPopulateList({ withImages: toBool(includeImages) });

    let qDoc = VerificationRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((pg - 1) * lim)
      .limit(lim);

    pops.forEach((p) => (qDoc = qDoc.populate(p)));

    const [items, total] = await Promise.all([qDoc.lean(), VerificationRequest.countDocuments(filter)]);
    res.json({ items, total, page: pg, limit: lim });
  } catch (err) {
    console.error("getVerificationRequests error:", err?.message, err?.stack);
    res.status(500).json({ message: "Failed to fetch verification requests" });
  }
};

// ===== Admin: get single request =====
// @route GET /api/verification-request/:id
// @access Private (admin)
exports.getVerificationRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const pops = buildPopulateList({ withImages: true });

    let q = VerificationRequest.findById(id);
    pops.forEach((p) => (q = q.populate(p)));

    const request = await q.lean();

    if (!request) return res.status(404).json({ message: "Request not found" });
    res.json(request);
  } catch (err) {
    console.error("getVerificationRequestById error:", err?.message, err?.stack);
    res.status(500).json({ message: "Failed to fetch request" });
  }
};
