const asyncHandler = require("express-async-handler");
const VCRequest = require("../models/vcRequestModel");
const fs = require("fs");

// @desc Student: Create VC Request with images
// @route POST /api/vc-requests
// @access Private (student)
const createVCRequest = asyncHandler(async (req, res) => {
  const { lrn, type, course, yearGraduated, did } = req.body;

  if (!type || !course) {
    res.status(400);
    throw new Error("Required fields missing: type or course");
  }

  // files from multer
  const faceFile = req.files?.faceImage?.[0];
  const idFile = req.files?.validIdImage?.[0];

  if (!faceFile || !idFile) {
    res.status(400);
    throw new Error("Both faceImage and validIdImage are required");
  }

  const newRequest = await VCRequest.create({
    student: req.user._id, // tie to logged-in student
    lrn: lrn || null, // optional now
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

  // cleanup uploaded temp files (async so no crash risk)
  fs.unlink(faceFile.path, () => {});
  fs.unlink(idFile.path, () => {});

  // exclude image buffers from response
  const { faceImage, validIdImage, ...rest } = newRequest.toObject();

  res.status(201).json(rest);
});

// @desc Student: Get my VC requests (without heavy image data)
// @route GET /api/vc-requests/mine
// @access Private (student)
const getMyVCRequests = asyncHandler(async (req, res) => {
  const requests = await VCRequest.find({ student: req.user._id })
    .select("-faceImage -validIdImage") // exclude image buffers
    .sort({ createdAt: -1 });
  res.status(200).json(requests);
});

// @desc Admin: Get all VC requests
// @route GET /api/vc-requests
// @access Private (admin)
const getAllVCRequests = asyncHandler(async (req, res) => {
  const requests = await VCRequest.find()
    .populate("student", "email fullName") // adjust to your User fields
    .select("-faceImage -validIdImage"); // exclude buffers
  res.status(200).json(requests);
});

// @desc Admin: Review VC request
// @route PATCH /api/vc-requests/:id
// @access Private (admin)
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
  request.reviewedBy = req.user._id;
  await request.save();

  // exclude buffers in response
  const { faceImage, validIdImage, ...rest } = request.toObject();

  res.status(200).json(rest);
});

module.exports = {
  createVCRequest,
  getMyVCRequests,
  getAllVCRequests,
  reviewVCRequest,
};
