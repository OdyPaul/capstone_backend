// backend/controllers/mobile/vcRequestController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const VCRequest = require('../../models/mobile/vcRequestModel');
const VcTemplate = require('../../models/web/vcTemplate');
const StudentData = require('../../models/testing/studentDataModel'); // ⬅ same path as issueService/issueController
const { createOneIssue } = require('../../services/issueService');
const { toFullName } = require('../../services/gradeService');

function httpError(status, message) {
  const err = new Error(message || 'Error');
  err.status = status;
  return err;
}

/**
 * POST /api/vc-requests
 *
 * Body (from mobile):
 *  - type: "TOR" | "DIPLOMA"
 *  - purpose: string (already lowercase from the app)
 *  - anchorNow: boolean
 *
 * Optional:
 *  - templateId: specific VC template
 *  - studentNumber: override (fallback if no account linkage)
 *
 * Flow:
 * 1. Resolve Student_Data via User.studentId or Student_Data.userId.
 * 2. Resolve templateId from type (TOR/DIPLOMA → slug "tor"/"diploma") if not provided.
 * 3. Call createOneIssue(...) → creates/reuses VcIssue in "issued" status.
 * 4. Create VCRequest doc for mobile tracking with paymentTxNo = issue.order_no.
 */
exports.createVCRequest = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) throw httpError(401, 'Unauthorized');

  let { type, purpose, anchorNow, templateId, studentNumber } = req.body || {};

  type = String(type || '').toUpperCase(); // "TOR" | "DIPLOMA"
  purpose = String(purpose || '').trim().toLowerCase(); // must match PURPOSES enum
  const anchorFlag = !!anchorNow;

  if (!type) throw httpError(400, 'type is required');
  if (!purpose) throw httpError(400, 'purpose is required');

  // ------------------------------------------------
  // 1) Resolve the linked Student_Data record
  // ------------------------------------------------
  let studentDoc = null;

  // 1a. via User.studentId (set by verification)
  if (user.studentId && mongoose.isValidObjectId(user.studentId)) {
    studentDoc = await StudentData.findById(user.studentId).lean();
  }

  // 1b. fallback via Student_Data.userId (also set by verification)
  if (!studentDoc) {
    studentDoc = await StudentData.findOne({ userId: user._id }).lean();
  }

  let resolvedStudentNumber = null;

  if (studentDoc) {
    resolvedStudentNumber = studentDoc.studentNumber || null;
  } else {
    // 1c. FINAL fallback: explicitly by studentNumber (body or user)
    resolvedStudentNumber =
      (studentNumber && String(studentNumber).trim()) ||
      (user.studentNumber && String(user.studentNumber).trim()) ||
      (user.username && String(user.username).trim()) ||
      null;

    if (!resolvedStudentNumber) {
      throw httpError(
        400,
        'No linked student record. Ask the registrar to link your account, or provide a studentNumber.'
      );
    }

    studentDoc = await StudentData.findOne({
      studentNumber: resolvedStudentNumber,
    }).lean();

    if (!studentDoc) {
      throw httpError(
        404,
        `Student not found for studentNumber "${resolvedStudentNumber}"`
      );
    }
  }

  const studentId = studentDoc._id;
  if (!resolvedStudentNumber) {
    resolvedStudentNumber = studentDoc.studentNumber || null;
  }

  // ------------------------------------------------
  // 2) Resolve templateId (TOR/DIPLOMA → slug)
  // ------------------------------------------------
  let tplId = templateId;
  if (tplId) {
    if (!mongoose.isValidObjectId(tplId)) {
      throw httpError(400, 'Invalid templateId');
    }
  } else {
    let slug;
    if (type === 'TOR') slug = 'tor';
    else if (type === 'DIPLOMA') slug = 'diploma';
    else slug = type.toLowerCase(); // fallback if you ever add more types

    const tpl = await VcTemplate.findOne({ slug }).select('_id').lean();
    if (!tpl) {
      throw httpError(404, `No VC template configured for type "${type}"`);
    }
    tplId = tpl._id;
  }

  // ------------------------------------------------
  // 3) Create or reuse an Issue (VcIssue) via service
  //    NOTE: we pass studentId so loadStudentContext will NOT fail.
  // ------------------------------------------------
  const issueResult = await createOneIssue({
    studentId: studentId.toString(),      // ⬅ main key
    studentNumber: resolvedStudentNumber, // extra safety
    templateId: tplId,
    type: type,            // "TOR" | "DIPLOMA" → inferKind() → "tor"/"diploma"
    purpose: purpose,      // same lowercase string used in both Issue + VCRequest
    anchorNow: anchorFlag,
  });

  const status = issueResult.status; // "created" | "duplicate"
  const issue = issueResult.issue;

  // ------------------------------------------------
  // 4) Denormalized fields for VCRequest document
  // ------------------------------------------------
  const studentFullName = toFullName(studentDoc);
  const studentProgram = studentDoc.program || null;
  const studentPhotoUrl = studentDoc.photoUrl || null;

  // This is what cashier will use
  const paymentTxNo = issue.order_no || issue._id.toString();

  const vcReq = await VCRequest.create({
    student: user._id,               // mobile account (User, authConn)
    studentId: studentId,            // linked Student_Data
    studentNumber: resolvedStudentNumber,
    studentFullName: studentFullName,
    studentProgram: studentProgram,
    studentPhotoUrl: studentPhotoUrl,
    type: type,                      // "TOR" | "DIPLOMA" (matches VCRequest enum)
    purpose: purpose,                // lowercase, matches PURPOSES enum
    anchorNow: anchorFlag,
    status: 'pending',               // request is pending; Issue itself is already "issued"
    paymentTxNo: paymentTxNo,
  });

  const httpStatus = status === 'created' ? 201 : 200;

  res.status(httpStatus).json({
    ...vcReq.toObject(),
    paymentTxNo: paymentTxNo,        // make sure app sees it at top-level
  });
});

/**
 * GET /api/vc-requests/mine
 * Returns the current user’s VC requests, newest first.
 */
exports.getMyVCRequests = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) throw httpError(401, 'Unauthorized');

  const rows = await VCRequest.find({ student: user._id })
    .sort({ createdAt: -1 })
    .lean();

  res.json(rows);
});

/**
 * (Admin) GET /api/vc-requests
 */
exports.getVCRequests = asyncHandler(async (_req, res) => {
  const rows = await VCRequest.find().sort({ createdAt: -1 }).lean();
  res.json(rows);
});

/**
 * (Admin) GET /api/vc-requests/:id
 */
exports.getVCRequestById = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid id');

  const row = await VCRequest.findById(id).lean();
  if (!row) throw httpError(404, 'Request not found');

  res.json(row);
});
