const asyncHandler = require("express-async-handler");
const VCRequest = require("../models/vcRequestModel");

// ===============================
// @desc    Student: Create a VC request
// @route   POST /api/vc-requests
// @access  Private (student)
// ===============================
const createVCRequest = asyncHandler(async (req, res) => {
  const { lrn, type, course, yearGraduated, did } = req.body;

  // Validate required fields
  if (!lrn || !type || !course) {
    res.status(400);
    throw new Error("Required fields missing: lrn, type, or course");
  }

  const newRequest = await VCRequest.create({
    lrn, // using LRN instead of student ObjectId
    type,
    course,
    yearGraduated: yearGraduated || null,
    did: did || null,
  });

  res.status(201).json(newRequest);
});

// Student: Get my VC requests
// @route GET /api/vc-requests/mine
// @access Private (student)
const getMyVCRequests = asyncHandler(async (req, res) => {
  const requests = await VCRequest.find({ lrn: req.user.lrn }); // use LRN instead of student ObjectId
  res.status(200).json(requests);
});


// ===============================
// @desc    Admin: Get all VC requests
// @route   GET /api/vc-requests
// @access  Private (admin)
// ===============================
const getAllVCRequests = asyncHandler(async (req, res) => {
  const requests = await VCRequest.find()
    .populate("student", "studentNumber fullName program");

  res.status(200).json(requests);
});

// ===============================
// @desc    Admin: Review VC request (Approve/Reject/Issue)
// @route   PUT /api/vc-requests/:id
// @access  Private (admin)
// ===============================
const reviewVCRequest = asyncHandler(async (req, res) => {
  const { status } = req.body;

  // Validate status
  const validStatuses = ["approved", "rejected", "issued"];
  if (!validStatuses.includes(status)) {
    res.status(400);
    throw new Error(`Invalid status. Allowed: ${validStatuses.join(", ")}`);
  }

  const request = await VCRequest.findById(req.params.id);
  if (!request) {
    res.status(404);
    throw new Error("VC request not found");
  }

  request.status = status;
  request.reviewedBy = req.user.id;
  await request.save();

  res.status(200).json(request);
});

module.exports = {
  createVCRequest,
  getMyVCRequests,
  getAllVCRequests,
  reviewVCRequest,
};
