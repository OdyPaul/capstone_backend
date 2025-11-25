// backend/controllers/mobile/vcRequestController.js

const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const VCRequest = require('../../models/mobile/vcRequestModel');
const VcTemplate = require('../../models/web/vcTemplate');
const StudentData = require('../../models/testing/studentDataModel');
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
 *  - studentNumber: override student number (else derived from req.user)
 */
exports.createVCRequest = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) throw httpError(401, 'Unauthorized');

  let { type, purpose, anchorNow, templateId, studentNumber } = req.body || {};

  type = String(type || '').toUpperCase();
  purpose = String(purpose || '').trim().toLowerCase();
  const anchorFlag = !!anchorNow;

  if (!type) throw httpError(400, 'type is required');
  if (!purpose) throw httpError(400, 'purpose is required');

  // ---- Resolve studentNumber ----
  studentNumber =
    (studentNumber && String(studentNumber).trim()) ||
    (user.studentNumber && String(user.studentNumber).trim()) ||
    (user.username && String(user.username).trim()) ||
    null;

  if (!studentNumber) {
    throw httpError(
      400,
      'studentNumber is required (not found in request or user profile)'
    );
  }

  // ---- Resolve templateId (TOR/DIPLOMA) ----
  let tplId = templateId;
  if (tplId) {
    if (!mongoose.isValidObjectId(tplId)) {
      throw httpError(400, 'Invalid templateId');
    }
  } else {
    let slug;
    if (type === 'TOR') slug = 'tor';
    else if (type === 'DIPLOMA') slug = 'diploma';
    else slug = type.toLowerCase(); // fallback

    const tpl = await VcTemplate.findOne({ slug }).select('_id').lean();
    if (!tpl) {
      throw httpError(404, `No VC template configured for type "${type}"`);
    }
    tplId = tpl._id;
  }

  // ---- Use core service to create (or reuse) an Issue ----
  const issueResult = await createOneIssue({
    studentNumber: studentNumber,
    templateId: tplId,
    type: type,
    purpose: purpose,
    anchorNow: anchorFlag,
  });

  const status = issueResult.status; // 'created' | 'duplicate'
  const issue = issueResult.issue;

  // ---- Load student document for denormalized fields ----
  let studentDoc = null;

  // If createOneIssue returned a populated student
  if (issue && issue.student && issue.student.studentNumber) {
    studentDoc = issue.student;
  } else if (issue && issue.student) {
    // Only ObjectId stored, fetch the student doc
    studentDoc = await StudentData.findById(issue.student).lean();
  }

  if (!studentDoc) {
    throw httpError(
      500,
      'Issue created but student record could not be loaded'
    );
  }

  const studentId = studentDoc._id;
  const finalStudentNumber = studentDoc.studentNumber || studentNumber;
  const studentFullName = toFullName(studentDoc);
  const studentProgram = studentDoc.program || null;
  const studentPhotoUrl = studentDoc.photoUrl || null;

  // This will be used by the student as a payment reference.
  // Prefer order_no if your VcIssue model has it; fallback to issue _id.
  const paymentTxNo = issue.order_no || issue._id.toString();

  // ---- Create VCRequest record (mobile tracking) ----
  const vcReq = await VCRequest.create({
    student: user._id,           // mobile account (User)
    studentId: studentId,        // linked student profile (StudentData / Student_Profiles)
    studentNumber: finalStudentNumber,
    studentFullName: studentFullName,
    studentProgram: studentProgram,
    studentPhotoUrl: studentPhotoUrl,
    type: type,                  // 'TOR' | 'DIPLOMA' (enum in model)
    purpose: purpose,            // lowercase; matches PURPOSES enum in model
    anchorNow: anchorFlag,
    status: 'pending',           // request is pending; Issue is already "issued"
    paymentTxNo: paymentTxNo,
  });

  // status 201 if we created a brand-new Issue; 200 if we just reused an existing one
  const httpStatus = status === 'created' ? 201 : 200;

  res.status(httpStatus).json({
    ...vcReq.toObject(),
    paymentTxNo, // explicitly ensure this field is at the top level for the app
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
 * Optional admin listing of all VC requests.
 */
exports.getVCRequests = asyncHandler(async (req, res) => {
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
