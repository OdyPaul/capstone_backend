const VerificationRequest = require("../../models/mobile/verificationRequestModel");
const Image = require("../../models/mobile/imageModel");
const User = require("../../models/common/userModel");

// @desc Student submits verification request
// @route POST /api/verification
// @access Private (student)
exports.createVerificationRequest = async (req, res) => {
  try {
    let { personal, education, selfieImageId, idImageId, DID, did } = req.body || {};

    // normalize DID from either casing
    const DIDValue = DID || did || null;

    // validate presence
    if (!personal || !education) {
      return res.status(400).json({ message: "Personal and education info required" });
    }
    if (!selfieImageId || !idImageId) {
      return res.status(400).json({ message: "Selfie and ID images are required" });
    }
    if (!DIDValue) {
      return res.status(400).json({ message: "DID is required. Please link your wallet first." });
    }
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // if strings slipped through, parse once
    if (typeof personal === "string") {
      try { personal = JSON.parse(personal); }
      catch { return res.status(400).json({ message: "personal must be a JSON object" }); }
    }
    if (typeof education === "string") {
      try { education = JSON.parse(education); }
      catch { return res.status(400).json({ message: "education must be a JSON object" }); }
    }

    // create request
    const verification = await VerificationRequest.create({
      user: req.user._id,
      personal,
      education,
      selfieImage: selfieImageId,
      idImage: idImageId,
      DID: DIDValue,         // 👈 store uppercase as per schema
      status: "pending",
    });

    // link images
    await Promise.all([
      Image.findByIdAndUpdate(selfieImageId, { ownerRequest: verification._id }),
      Image.findByIdAndUpdate(idImageId, { ownerRequest: verification._id }),
    ]);

    return res.status(201).json(verification);
  } catch (err) {
    // handle unique DID collisions nicely
    if (err?.code === 11000 && err?.keyPattern?.DID) {
      return res.status(409).json({ message: "DID already used in another request" });
    }
    console.error("createVerificationRequest error:", err);
    return res.status(500).json({ message: err.message || "Failed to submit verification" });
  }
};

// @desc Admin verifies a request
// @route POST /api/verification/:id/verify
// @access Private (admin)
exports.verifyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const verification = await VerificationRequest.findById(id);
    if (!verification) return res.status(404).json({ message: "Not found" });

    verification.status = "verified";
    verification.verifiedAt = new Date();
    await verification.save();

    // Mark user as verified
    await User.findByIdAndUpdate(verification.user, { verified: "verified" });

    // Expire images in 30 days
    const expireDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const updates = [];
    if (verification.selfieImage) updates.push(Image.findByIdAndUpdate(verification.selfieImage, { expiresAt: expireDate }));
    if (verification.idImage) updates.push(Image.findByIdAndUpdate(verification.idImage, { expiresAt: expireDate }));
    await Promise.all(updates);

    return res.json({
      message: "✅ User account verified, request updated, images set to expire in 30 days",
    });
  } catch (err) {
    console.error("verifyRequest error:", err);
    return res.status(500).json({ message: err.message || "Failed to verify request" });
  }
};

// @desc Student fetches their own requests
// @route GET /api/verification/mine
// @access Private (student)
exports.getMyVerificationRequests = async (req, res) => {
  try {
    const requests = await VerificationRequest.find({ user: req.user._id })
      .populate("selfieImage", "url")
      .populate("idImage", "url")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    console.error("getMyVerificationRequests error:", err);
    res.status(500).json({ message: "Failed to fetch your verification requests" });
  }
};

// @desc Admin fetch all requests
// @route GET /api/verification
// @access Private (admin)
exports.getVerificationRequests = async (req, res) => {
  try {
    const requests = await VerificationRequest.find()
      .populate("user", "email name")
      .populate("selfieImage", "url")
      .populate("idImage", "url")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    console.error("getVerificationRequests error:", err);
    res.status(500).json({ message: "Failed to fetch verification requests" });
  }
};

// @desc Admin fetch single request
// @route GET /api/verification/:id
// @access Private (admin)
exports.getVerificationRequestById = async (req, res) => {
  try {
    const request = await VerificationRequest.findById(req.params.id)
      .populate("user", "email name")
      .populate("selfieImage", "url")
      .populate("idImage", "url");

    if (!request) return res.status(404).json({ message: "Request not found" });

    res.json(request);
  } catch (err) {
    console.error("getVerificationRequestById error:", err);
    res.status(500).json({ message: "Failed to fetch request" });
  }
};
