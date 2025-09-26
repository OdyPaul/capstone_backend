const asyncHandler = require("express-async-handler");
const VCRequest = require("../models/vcRequestModel");
const BASE_URL = process.env.BASE_URL || process.env.API_URL || "http://127.0.0.1:5000";

// Create VC Request
const createVCRequest = asyncHandler(async (req, res) => {
  const { lrn, type, course, yearGraduated, did } = req.body;

  if (!type || !course) {
    res.status(400);
    throw new Error("Required fields missing: type or course");
  }

  const faceFile = req.files?.faceImage?.[0];
  const idFile = req.files?.validIdImage?.[0];

  if (!faceFile || !idFile) {
    res.status(400);
    throw new Error("Both faceImage and validIdImage are required");
  }

  const newRequest = await VCRequest.create({
    student: req.user._id,
    lrn: lrn || null,
    type,
    course,
    yearGraduated: yearGraduated || null,
    did: did || null,
    faceImage: {
      filename: faceFile.originalname,
      data: faceFile.buffer,
      contentType: faceFile.mimetype,
    },
    validIdImage: {
      filename: idFile.originalname,
      data: idFile.buffer,
      contentType: idFile.mimetype,
    },
  });

  const { faceImage, validIdImage, ...rest } = newRequest.toObject();
  res.status(201).json(rest);
});

// Get current user's requests (without image buffers)
const getMyVCRequests = asyncHandler(async (req, res) => {
  const requests = await VCRequest.find({ student: req.user._id })
    .select("-faceImage -validIdImage")
    .sort({ createdAt: -1 });

  res.status(200).json(requests);
});

// Admin: get all requests
const getAllVCRequests = asyncHandler(async (req, res) => {
  const requests = await VCRequest.find()
    .populate("student", "email name")
    .select("-faceImage -validIdImage");

  const requestsWithUrls = requests.map((req) => {
    const obj = req.toObject();
    obj.faceImageUrl = `${BASE_URL}/api/vc-requests/face/${req._id}`;
    obj.validIdImageUrl = `${BASE_URL}/api/vc-requests/valid-id/${req._id}`;
    return obj;
  });

  res.status(200).json(requestsWithUrls);
});

// Admin: review request
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

  const { faceImage, validIdImage, ...rest } = request.toObject();
  res.status(200).json(rest);
});

// Serve face image
const getFaceImage = asyncHandler(async (req, res) => {
  const request = await VCRequest.findById(req.params.id);
  if (!request || !request.faceImage?.data) {
    res.status(404);
    throw new Error("Face image not found");
  }

  res.set("Content-Type", request.faceImage.contentType);
  res.send(request.faceImage.data);
});

// Serve valid ID image
const getValidIdImage = asyncHandler(async (req, res) => {
  const request = await VCRequest.findById(req.params.id);
  if (!request || !request.validIdImage?.data) {
    res.status(404);
    throw new Error("Valid ID image not found");
  }

  res.set("Content-Type", request.validIdImage.contentType);
  res.send(request.validIdImage.data);
});

module.exports = {
  createVCRequest,
  getMyVCRequests,
  getAllVCRequests,
  reviewVCRequest,
  getFaceImage,
  getValidIdImage,
};
