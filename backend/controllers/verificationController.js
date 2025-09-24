const asyncHandler = require('express-async-handler');
const Verification = require('../models/verificationModel');
const fs = require('fs');

// @desc Upload a verification file (face or valid ID)
// @route POST /api/verifications/:purpose
// @access Private (user)
const uploadVerification = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No file uploaded');
  }

  const { purpose } = req.params;
  if (!['user_face', 'valid_id'].includes(purpose)) {
    res.status(400);
    throw new Error('Invalid purpose');
  }

  const fileBuffer = fs.readFileSync(req.file.path);

  const verification = await Verification.create({
    user: req.user.id,
    purpose,
    filename: req.file.filename,
    data: fileBuffer,
    contentType: req.file.mimetype,
  });

  // remove temp file from disk
  fs.unlinkSync(req.file.path);

  res.status(201).json({
    _id: verification.id,
    purpose: verification.purpose,
    status: verification.status,
  });
});

// @desc Get user’s verification files
// @route GET /api/verifications
// @access Private (user)
const getMyVerifications = asyncHandler(async (req, res) => {
  const verifications = await Verification.find({ user: req.user.id });
  res.json(verifications);
});

// @desc Admin: Get all verifications
// @route GET /api/verifications/admin
// @access Private (admin only)
const getAllVerifications = asyncHandler(async (req, res) => {
  const verifications = await Verification.find().populate('user', 'name email');
  res.json(verifications);
});

// @desc Admin: Approve or Reject a verification
// @route PUT /api/verifications/:id
// @access Private (admin only)
const reviewVerification = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    res.status(400);
    throw new Error('Invalid status');
  }

  const verification = await Verification.findById(req.params.id);
  if (!verification) {
    res.status(404);
    throw new Error('Verification not found');
  }

  verification.status = status;
  verification.reviewedBy = req.user.id;
  await verification.save();

  res.json({
    message: `Verification ${status}`,
    verification,
  });
});

module.exports = {
  uploadVerification,
  getMyVerifications,
  getAllVerifications,
  reviewVerification,
};
