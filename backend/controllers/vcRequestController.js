const asyncHandler = require("express-async-handler");
const VCRequest = require("../models/vcRequestModel");
const fs = require("fs");

// @desc Student: Create VC Request with images
// @route POST /api/vc-requests
// @access Private (student)
const createVCRequest = asyncHandler(async (req, res) => {
  const { lrn, type, course, yearGraduated, did } = req.body;

  if (!lrn || !type || !course) {
    res.status(400);
    throw new Error("Required fields missing: lrn, type, or course");
  }

  // files from multer
  const faceFile = req.files?.faceImage?.[0];
  const idFile = req.files?.validIdImage?.[0];

  if (!faceFile || !idFile) {
    res.status(400);
    throw new Error("Both faceImage and validIdImage are required");
  }

  const newRequest = await VCRequest.create({
    lrn,
    type,
    course,
    yearGraduated: yearGraduated || null,
    did: did || null,
    faceImage: {
      filename: faceFile.filename,
      data: fs.readFileSync(faceFile.path),
      contentType: faceFile.mimetype,
    },
    validIdImage: {
      filename: idFile.filename,
      data: fs.readFileSync(idFile.path),
      contentType: idFile.mimetype,
    },
  });

  // cleanup uploaded temp files
  fs.unlinkSync(faceFile.path);
  fs.unlinkSync(idFile.path);

  res.status(201).json(newRequest);
});

// Student: Get my VC requests
const getMyVCRequests = asyncHandler(async (req, res) => {
  const lrn = req.user.lrn;
  const requests = await VCRequest.find({ lrn });
  res.status(200).json(requests);
});

// Admin: Get all VC requests
const getAllVCRequests = asyncHandler(async (req, res) => {
  const requests = await VCRequest.find().populate(
    "student",
    "studentNumber fullName program"
  );
  res.status(200).json(requests);
});

// Admin: Review VC request
const reviewVCRequest = asyncHandler(async (req, res) => {
  const { status } = req.body;
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
