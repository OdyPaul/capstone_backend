const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const VCRequest = require('../../models/mobile/vcRequestModel');
const User = require('../../models/common/userModel');

// Resolve the actual student profile collection name, fallback to "student_profiles"
let STUDENT_COLLECTION = 'student_profiles';
try {
  const StudentProfile = require('../../models/student/studentProfileModel'); // adjust if needed
  if (StudentProfile?.collection?.name) STUDENT_COLLECTION = StudentProfile.collection.name;
} catch { /* use fallback */ }

const ALLOWED_TYPES = ['TOR', 'DIPLOMA'];

/**
 * POST /api/vc-requests
 * Student creates a VC request
 * Body: { type: "TOR" | "DIPLOMA" }
 */
const createVCRequest = asyncHandler(async (req, res) => {
  let { type } = req.body;
  if (!type) {
    res.status(400);
    throw new Error('Missing field: type');
  }
  type = String(type).toUpperCase().trim();
  if (!ALLOWED_TYPES.includes(type)) {
    res.status(400);
    throw new Error(`Invalid type. Allowed: ${ALLOWED_TYPES.join(', ')}`);
  }

  // Read verified + studentId from the authenticated user
  const user = await User.findById(req.user._id).select('verified studentId');
  if (!user) {
    res.status(401);
    throw new Error('User not found');
  }

  const isVerified = String(user.verified || '').toLowerCase() === 'verified';
  if (!isVerified) {
    res.status(403);
    throw new Error('Account not verified');
  }

  if (!user.studentId) {
    res.status(400);
    throw new Error('No studentId linked to this user');
  }

  const doc = await VCRequest.create({
    student: req.user._id,
    studentId: user.studentId,
    type,
  });

  // Return a trimmed object
  res.status(201).json({
    _id: doc._id,
    student: doc.student,
    studentId: doc.studentId,
    type: doc.type,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
});

/**
 * GET /api/vc-requests/mine
 * Student: list own VC requests
 */
const getMyVCRequests = asyncHandler(async (req, res) => {
  const list = await VCRequest.find({ student: req.user._id })
    .select('_id student studentId type status createdAt updatedAt')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json(list);
});

/**
 * GET /api/vc-requests
 * Admin: list all VC requests with joined user & student profile
 */
const getAllVCRequests = asyncHandler(async (_req, res) => {
  const rows = await VCRequest.aggregate([
    { $sort: { createdAt: -1 } },

    // Join auth user (a read-only shadow "users" should exist on vcConn)
    {
      $lookup: {
        from: 'users',
        localField: 'student',
        foreignField: '_id',
        as: 'studentAccount',
      },
    },
    { $unwind: { path: '$studentAccount', preserveNullAndEmptyArrays: true } },

    // Join student profile by ObjectId
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
        status: 1,
        createdAt: 1,
        updatedAt: 1,
        student: 1,
        studentId: 1,
        'studentAccount.email': 1,
        'studentAccount.username': 1,
        'studentAccount.verified': 1,
        'studentAccount.profilePicture': 1,
        'studentProfile._id': 1,
        'studentProfile.fullName': 1,
        'studentProfile.program': 1,
        'studentProfile.photoUrl': 1,
        'studentProfile.studentNumber': 1,
      },
    },
  ]);

  res.status(200).json(rows);
});

/**
 * GET /api/vc-requests/:id
 * Admin: get one VC request with joins
 */
const getVCRequestById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    res.status(400);
    throw new Error('Invalid id');
  }

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
        status: 1,
        createdAt: 1,
        updatedAt: 1,
        student: 1,
        studentId: 1,
        'studentAccount.email': 1,
        'studentAccount.username': 1,
        'studentAccount.verified': 1,
        'studentAccount.profilePicture': 1,
        'studentProfile._id': 1,
        'studentProfile.fullName': 1,
        'studentProfile.program': 1,
        'studentProfile.photoUrl': 1,
        'studentProfile.studentNumber': 1,
      },
    },
  ]);

  if (!rows.length) {
    res.status(404);
    throw new Error('VC request not found');
  }

  res.status(200).json(rows[0]);
});

/**
 * PATCH /api/vc-requests/:id
 * Admin: review (approve/reject/issue)
 * Body: { status: "approved" | "rejected" | "issued" }
 */
const reviewVCRequest = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['approved', 'rejected', 'issued'];
  if (!validStatuses.includes(status)) {
    res.status(400);
    throw new Error(`Invalid status. Allowed: ${validStatuses.join(', ')}`);
  }

  const doc = await VCRequest.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error('VC request not found');
  }

  doc.status = status;
  doc.reviewedBy = req.user._id;
  await doc.save();

  res.status(200).json({
    _id: doc._id,
    student: doc.student,
    studentId: doc.studentId,
    type: doc.type,
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
};
