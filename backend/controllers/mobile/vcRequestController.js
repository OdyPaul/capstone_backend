// controllers/mobile/vcRequestController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const VCRequest = require('../../models/mobile/vcRequestModel');
const { PURPOSES } = require('../../models/mobile/vcRequestModel');
const User = require('../../models/common/userModel');
const Student = require('../../models/students/studentModel');
const VcTemplate = require('../../models/web/vcTemplate');
const { createDraftFromRequest } = require('../web/draftVcController');

/* 🔔 Minimal audit (auth DB) */
const { getAuthConn } = require('../../config/db');
const AuditLogSchema = require('../../models/common/auditLog.schema');

let AuditLogAuth = null;
function getAuditLogAuth() {
  try {
    if (!AuditLogAuth) {
      const conn = getAuthConn();
      if (!conn) return null;
      AuditLogAuth =
        conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
    }
    return AuditLogAuth;
  } catch {
    return null;
  }
}

async function emitVcreqAudit({
  actorId,
  actorRole,
  event,
  recipientId,
  targetId,
  title,
  body,
  extra = {},
  dedupeKey,
}) {
  try {
    const AuditLog = getAuditLogAuth();
    if (!AuditLog) return;

    if (dedupeKey) {
      const exists = await AuditLog.exists({ 'meta.dedupeKey': dedupeKey });
      if (exists) return;
    }

    await AuditLog.create({
      ts: new Date(),
      actorId: actorId || null,
      actorRole: actorRole || null,
      ip: null,
      ua: '',
      method: 'INTERNAL',
      path: '/mobile/vc-request',
      status: 200,
      latencyMs: 0,
      routeTag: 'vcreq.activity',
      query: {},
      params: {},
      bodyKeys: [],
      draftId: null,
      paymentId: null,
      vcId: null,
      meta: {
        event,
        recipients: recipientId ? [String(recipientId)] : [],
        targetKind: 'vc_request',
        targetId: targetId || null,
        title: title || null,
        body: body || null,
        dedupeKey: dedupeKey || undefined,
        ...extra,
      },
    });
  } catch {
    /* swallow */
  }
}

const ALLOWED_TYPES = ['TOR', 'DIPLOMA'];

// 🔎 Pick a default template per type (latest matching template)
async function findDefaultTemplateForType(type) {
  const t = String(type || '').toUpperCase();
  const kind = t === 'TOR' ? 'tor' : 'diploma';
  const rx = kind === 'tor' ? /tor/i : /diploma/i;

  // Prefer templates whose vc.type contains the kind
  let tpl = await VcTemplate.findOne({ 'vc.type': rx })
    .sort({ updatedAt: -1 })
    .lean();
  if (!tpl) {
    // Fallback: match by name/slug if needed
    tpl = await VcTemplate.findOne({ $or: [{ name: rx }, { slug: rx }] })
      .sort({ updatedAt: -1 })
      .lean();
  }
  return tpl || null;
}

/* -------------------- create VC request (mobile) --------------------------- */
const createVCRequest = asyncHandler(async (req, res) => {
  let { type, purpose, anchorNow } = req.body || {};
  type = String(type || '').trim().toUpperCase();
  purpose = String(purpose || '').trim().toLowerCase();
  const anchor = Boolean(anchorNow);

  if (!ALLOWED_TYPES.includes(type)) {
    res.status(400);
    throw new Error(`Invalid type. Allowed: ${ALLOWED_TYPES.join(', ')}`);
  }
  if (!purpose) {
    res.status(400);
    throw new Error('Purpose is required');
  }
  if (!PURPOSES.includes(purpose)) {
    res.status(400);
    throw new Error('Invalid purpose value');
  }

  const user = await User.findById(req.user._id).select('verified studentId role');
  if (!user) {
    res.status(401);
    throw new Error('User not found');
  }
  if (String(user.verified || '').toLowerCase() !== 'verified') {
    res.status(403);
    throw new Error('Account not verified');
  }
  if (!user.studentId) {
    res.status(400);
    throw new Error('No studentId linked to this user');
  }

  const stu = await Student.findById(user.studentId)
    .select('_id studentNumber fullName program photoUrl')
    .lean();
  if (!stu) {
    res.status(400);
    throw new Error('Linked student profile not found');
  }

  // 1) Create the VC request row
  let doc = await VCRequest.create({
    student: req.user._id,
    studentId: stu._id,
    studentNumber: stu.studentNumber || null,
    studentFullName: stu.fullName || null,
    studentProgram: stu.program || null,
    studentPhotoUrl: stu.photoUrl || null,
    type,
    purpose,
    anchorNow: anchor,
  });

  // 2) Compute expiration: 3 months from now
  const expirationDate = new Date();
  expirationDate.setMonth(expirationDate.getMonth() + 3);

  // 3) Best-effort: auto-create a VC draft + payment
  let draft = null;
  let draftPaymentTxNo = null;

  try {
    const tpl = await findDefaultTemplateForType(type);
    if (tpl && typeof createDraftFromRequest === 'function') {
      const result = await createDraftFromRequest({
        studentId: stu._id,
        templateId: tpl._id,
        type,
        purpose,
        expiration: expirationDate,
        overrides: {}, // optional: pass TOR filters here if you need them
        clientTx: null,
        anchorNow: anchor,
      });

      if (result) {
        if (result.draft) {
          draft = result.draft;
        } else if (result.status === 'created' && result._id) {
          // In case implementation changes
          draft = result;
        }
      }

      if (draft && draft.payment_tx_no) {
        draftPaymentTxNo = String(draft.payment_tx_no);
      }
    }
  } catch (e) {
    // do not block the request if draft creation fails; just log via audit
    await emitVcreqAudit({
      actorId: req.user._id,
      actorRole: user.role || null,
      event: 'vc_request.draft_failed',
      recipientId: req.user._id,
      targetId: doc._id,
      title: 'VC draft creation failed',
      body: e.message || 'Error while auto-creating VC draft',
      extra: { type, purpose },
      dedupeKey: `vcreq.draft_failed:${doc._id}`,
    });
  }

  // 4) Link draft + paymentTxNo back to request (if created)
  if (draft && draft._id) {
    doc.draft = draft._id;
  }
  if (draftPaymentTxNo) {
    doc.paymentTxNo = draftPaymentTxNo;
  }
  if (doc.isModified()) {
    await doc.save();
  }

  // 5) Audit main creation event
  await emitVcreqAudit({
    actorId: req.user._id,
    actorRole: user.role || null,
    event: 'vc_request.created',
    recipientId: req.user._id,
    targetId: doc._id,
    title: 'VC request submitted',
    body: `Your ${type} request was submitted.`,
    extra: {
      type,
      purpose,
      status: doc.status || 'pending',
      anchorNow: doc.anchorNow,
      draftId: doc.draft || null,
      draftExpiration: expirationDate,
      draftPaymentTxNo: draftPaymentTxNo || null,
    },
    dedupeKey: `vcreq.created:${doc._id}`,
  });

  // 6) Response to mobile app
  res.status(201).json({
    _id: doc._id,
    student: doc.student,
    studentId: doc.studentId,
    studentNumber: doc.studentNumber,
    studentFullName: doc.studentFullName,
    studentProgram: doc.studentProgram,
    studentPhotoUrl: doc.studentPhotoUrl,
    type: doc.type,
    purpose: doc.purpose,
    anchorNow: doc.anchorNow,
    draft: doc.draft,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    paymentTxNo: draftPaymentTxNo || doc.paymentTxNo || null,
  });
});

/* --------------------- other handlers (unchanged) -------------------------- */

const getMyVCRequests = asyncHandler(async (req, res) => {
  const list = await VCRequest.find({ student: req.user._id })
    .select(
      '_id student studentId studentNumber studentFullName studentProgram studentPhotoUrl type purpose anchorNow draft status paymentTxNo createdAt updatedAt'
    )
    .sort({ createdAt: -1 })
    .lean();
  res.status(200).json(list);
});

const deleteVCRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid id');
  }
  const del = await VCRequest.deleteOne({ _id: id });
  if (!del.deletedCount) {
    res.status(404);
    throw new Error('VC request not found or already deleted');
  }
  res.json({ _id: id, deleted: true });
});

const getAllVCRequests = asyncHandler(async (_req, res) => {
  let STUDENT_COLLECTION = 'student_profiles';
  try {
    if (Student?.collection?.name) STUDENT_COLLECTION = Student.collection.name;
  } catch {}

  const rows = await VCRequest.aggregate([
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'student',
        foreignField: '_id',
        as: 'studentAccount',
      },
    },
    { $unwind: { path: '$studentAccount', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: STUDENT_COLLECTION,
        localField: 'studentId',
        foreignField: '_id',
        as: 'studentProfile',
      },
    },
    { $unwind: { path: '$studentProfile', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        type: 1,
        purpose: 1,
        status: 1,
        anchorNow: 1,
        draft: 1,
        createdAt: 1,
        updatedAt: 1,
        student: 1,
        studentId: 1,
        studentNumber: 1,
        studentFullName: 1,
        studentProgram: 1,
        studentPhotoUrl: 1,
        paymentTxNo: 1,
        'studentProfile._id': 1,
        'studentProfile.fullName': 1,
        'studentProfile.program': 1,
        'studentProfile.studentNumber': 1,
        'studentProfile.photoUrl': 1,
        'studentAccount.email': 1,
        'studentAccount.username': 1,
        'studentAccount.verified': 1,
        'studentAccount.profilePicture': 1,
      },
    },
  ]);

  res.status(200).json(rows);
});

const getVCRequestById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    res.status(400);
    throw new Error('Invalid id');
  }

  let STUDENT_COLLECTION = 'student_profiles';
  try {
    if (Student?.collection?.name) STUDENT_COLLECTION = Student.collection.name;
  } catch {}

  const rows = await VCRequest.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    {
      $lookup: {
        from: 'users',
        localField: 'student',
        foreignField: '_id',
        as: 'studentAccount',
      },
    },
    { $unwind: { path: '$studentAccount', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: STUDENT_COLLECTION,
        localField: 'studentId',
        foreignField: '_id',
        as: 'studentProfile',
      },
    },
    { $unwind: { path: '$studentProfile', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        type: 1,
        purpose: 1,
        status: 1,
        anchorNow: 1,
        draft: 1,
        createdAt: 1,
        updatedAt: 1,
        student: 1,
        studentId: 1,
        studentNumber: 1,
        studentFullName: 1,
        studentProgram: 1,
        studentPhotoUrl: 1,
        paymentTxNo: 1,
        'studentProfile._id': 1,
        'studentProfile.fullName': 1,
        'studentProfile.program': 1,
        'studentProfile.studentNumber': 1,
        'studentProfile.photoUrl': 1,
        'studentAccount.email': 1,
        'studentAccount.username': 1,
        'studentAccount.verified': 1,
        'studentAccount.profilePicture': 1,
      },
    },
  ]);

  if (!rows.length) {
    res.status(404);
    throw new Error('VC request not found');
  }
  res.status(200).json(rows[0]);
});

const reviewVCRequest = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const valid = ['approved', 'rejected', 'issued'];
  if (!valid.includes(status)) {
    res.status(400);
    throw new Error(`Invalid status. Allowed: ${valid.join(', ')}`);
  }
  const doc = await VCRequest.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error('VC request not found');
  }
  doc.status = status;
  doc.reviewedBy = req.user._id;
  await doc.save();

  const eventMap = {
    approved: 'vc_request.approved',
    rejected: 'vc_request.rejected',
    issued: 'vc_request.issued',
  };

  await emitVcreqAudit({
    actorId: req.user._id,
    actorRole: req.user.role || null,
    event: eventMap[status],
    recipientId: doc.student,
    targetId: doc._id,
    title:
      status === 'approved'
        ? 'VC request approved'
        : status === 'issued'
        ? 'VC issued'
        : 'VC request rejected',
    body:
      status === 'approved'
        ? 'Your VC request was approved.'
        : status === 'issued'
        ? 'Your verifiable credential has been issued.'
        : 'Your VC request was rejected.',
    extra: { status },
    dedupeKey: `vcreq.status:${doc._id}:${status}`,
  });

  res.status(200).json({
    _id: doc._id,
    student: doc.student,
    studentId: doc.studentId,
    studentNumber: doc.studentNumber,
    studentFullName: doc.studentFullName,
    studentProgram: doc.studentProgram,
    studentPhotoUrl: doc.studentPhotoUrl,
    type: doc.type,
    purpose: doc.purpose,
    anchorNow: doc.anchorNow,
    draft: doc.draft,
    status: doc.status,
    reviewedBy: doc.reviewedBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
});

module.exports = {
  createVCRequest,
  getMyVCRequests,
  getAllVCRequests,
  getVCRequestById,
  reviewVCRequest,
  deleteVCRequest,
};
