// controllers/mobile/verificationController.js
const { isValidObjectId } = require("mongoose");

const VerificationRequest = require("../../models/mobile/verificationRequestModel");
const Image = require("../../models/mobile/imageModel");
const User = require("../../models/common/userModel");
const Student = require("../../models/students/studentModel");
const { enqueueVerify, enqueueReject } = require("../../queues/verification.queue");

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

// ===== Student submits a verification request =====
// @route POST /api/verification
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

    // Parse JSON if sent as strings
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

    // Link images back to the request
    await Promise.all([
      Image.findByIdAndUpdate(selfieImageId, { ownerRequest: verification._id }),
      Image.findByIdAndUpdate(idImageId, { ownerRequest: verification._id }),
    ]);

    return res.status(201).json(verification);
  } catch (err) {
    if (err?.code === 11000 && (err?.keyPattern?.did || err?.keyValue?.did)) {
      return res.status(409).json({ message: "DID already used in another request" });
    }
    console.error("createVerificationRequest error:", err);
    return res.status(err.statusCode || 500).json({
      message: err.message || "Failed to submit verification",
    });
  }
};

// ===== Admin: queue verify (optionally link to Student in worker) =====
// @route POST /api/verification/:id/verify
// @access Private (admin)
exports.verifyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { studentId } = req.body || {};

    if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });
    if (studentId && !isValidObjectId(studentId)) {
      return res.status(400).json({ message: "Invalid studentId" });
    }

    // Light existence check so we can fail fast
    const vr = await VerificationRequest.findById(id).select("_id status");
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

    return res.status(202).json({ queued: true, action: "verify", requestId: id, studentId: studentId || null });
  } catch (err) {
    console.error("verifyRequest enqueue error:", err);
    return res.status(500).json({ message: err.message || "Failed to queue verify" });
  }
};

// ===== Admin: queue reject =====
// @route POST /api/verification/:id/reject
// @access Private (admin)
exports.rejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    // Light existence check
    const vr = await VerificationRequest.findById(id).select("_id status");
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

    return res.status(202).json({ queued: true, action: "reject", requestId: id });
  } catch (err) {
    console.error("rejectRequest enqueue error:", err);
    return res.status(500).json({ message: err.message || "Failed to queue reject" });
  }
};

// ===== Student: list own requests =====
// @route GET /api/verification/mine
// @access Private (student)
exports.getMyVerificationRequests = async (req, res) => {
  try {
    const requests = await VerificationRequest.find({ user: req.user._id })
      .populate("selfieImage", "url")
      .populate("idImage", "url")
      .sort({ createdAt: -1 })
      .lean();

    res.json(requests);
  } catch (err) {
    console.error("getMyVerificationRequests error:", err);
    res.status(500).json({ message: "Failed to fetch your verification requests" });
  }
};

// ===== Admin: list requests (filters & pagination) =====
// @route GET /api/verification
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
      const safe = String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { did: { $regex: safe, $options: "i" } },
        { "personal.fullName": { $regex: safe, $options: "i" } },
      ];
    }

    if (from) filter.createdAt = { ...(filter.createdAt || {}), $gte: new Date(from) };
    if (to) filter.createdAt = { ...(filter.createdAt || {}), $lte: new Date(to) };

    const qDoc = VerificationRequest.find(filter)
      .populate("user", "email username fullName role")
      .populate("student", "fullName studentNumber program")
      .sort({ createdAt: -1 })
      .skip((pg - 1) * lim)
      .limit(lim);

    if (toBool(includeImages)) {
      qDoc.populate("selfieImage", "url").populate("idImage", "url");
    }

    const [items, total] = await Promise.all([
      qDoc.lean(),
      VerificationRequest.countDocuments(filter),
    ]);

    res.json({ items, total, page: pg, limit: lim });
  } catch (err) {
    console.error("getVerificationRequests error:", err);
    res.status(500).json({ message: "Failed to fetch verification requests" });
  }
};

// ===== Admin: get single request =====
// @route GET /api/verification/:id
// @access Private (admin)
exports.getVerificationRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const request = await VerificationRequest.findById(id)
      .populate("user", "email username fullName role")
      .populate("student", "fullName studentNumber program")
      .populate("selfieImage", "url")
      .populate("idImage", "url")
      .lean();

    if (!request) return res.status(404).json({ message: "Request not found" });

    res.json(request);
  } catch (err) {
    console.error("getVerificationRequestById error:", err);
    res.status(500).json({ message: "Failed to fetch request" });
  }
};
