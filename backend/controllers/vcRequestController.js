const asyncHandler = require("express-async-handler");
const VCRequest = require("../models/vcRequestModel");
const Student = require("../models/studentModel");

// @desc Student creates VC request
// @route POST /api/vc-requests
// @access Private (student)
const createVCRequest = asyncHandler(async (req, res) => {
  const { studentId, type, course, yearGraduated, did } = req.body;

  if (!studentId || !type || !course) {
    res.status(400);
    throw new Error("Missing required fields (studentId, type, course)");
  }

  const student = await Student.findById(studentId);
  if (!student) {
    res.status(404);
    throw new Error("Student not found");
  }

  const request = await VCRequest.create({
    student: studentId,
    type,
    course,
    yearGraduated: yearGraduated || null,
    did: did || undefined, // will fallback to default random
  });

  res.status(201).json(request);
});

// @desc Student gets their VC requests
// @route GET /api/vc-requests/mine
// @access Private (student)
const getMyVCRequests = asyncHandler(async (req, res) => {
  const requests = await VCRequest.find({ student: req.user.studentId })
    .populate("student", "studentNumber fullName program");
  res.json(requests);
});

// @desc Admin: Get all VC requests
// @route GET /api/vc-requests
// @access Private (admin)
const getAllVCRequests = asyncHandler(async (req, res) => {
  const requests = await VCRequest.find()
    .populate("student", "studentNumber fullName program");
  res.json(requests);
});

// @desc Admin: Approve/Reject/Issue VC request
// @route PUT /api/vc-requests/:id
// @access Private (admin)
const reviewVCRequest = asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!["approved", "rejected", "issued"].includes(status)) {
    res.status(400);
    throw new Error("Invalid status");
  }

  const request = await VCRequest.findById(req.params.id);
  if (!request) {
    res.status(404);
    throw new Error("VC Request not found");
  }

  request.status = status;
  request.reviewedBy = req.user.id;
  await request.save();

  res.json(request);
});

module.exports = {
  createVCRequest,
  getMyVCRequests,
  getAllVCRequests,
  reviewVCRequest,
};
