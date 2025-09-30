const VerificationRequest = require("../../models/mobile/verificationRequestModel");
const Image = require("../../models/mobile/imageModel");
const User = require("../../models/common/userModel");

// Student submits verification request
exports.createVerificationRequest = async (req, res) => {
  try {
    const { personal, education, selfieImageId, idImageId } = req.body;

    const verification = await VerificationRequest.create({
      user: req.user._id,
      personal,
      education,
      selfieImage: selfieImageId,
      idImage: idImageId,
      status: "pending",
    });

    if (selfieImageId) await Image.findByIdAndUpdate(selfieImageId, { ownerRequest: verification._id });
    if (idImageId) await Image.findByIdAndUpdate(idImageId, { ownerRequest: verification._id });

    return res.status(201).json(verification);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

// Admin verifies
exports.verifyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const verification = await VerificationRequest.findById(id);
    if (!verification) return res.status(404).json({ message: "Not found" });

    verification.status = "verified";
    verification.verifiedAt = new Date();
    await verification.save();

    await User.findByIdAndUpdate(verification.user, { verified: "verified" });

    // Expire images in 30 days
    const expireDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const updates = [];
    if (verification.selfieImage)
      updates.push(Image.findByIdAndUpdate(verification.selfieImage, { expiresAt: expireDate }));
    if (verification.idImage)
      updates.push(Image.findByIdAndUpdate(verification.idImage, { expiresAt: expireDate }));
    await Promise.all(updates);

    return res.json({
      message: "Verified: user account updated, request marked verified, images expire in 30 days",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

// Admin fetch all
exports.getVerificationRequests = async (req, res) => {
  try {
    const requests = await VerificationRequest.find()
      .populate("selfieImage", "url")
      .populate("idImage", "url")
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch verification requests" });
  }
};

// Admin fetch single
exports.getVerificationRequestById = async (req, res) => {
  try {
    const request = await VerificationRequest.findById(req.params.id)
      .populate("selfieImage", "url")
      .populate("idImage", "url");
    if (!request) return res.status(404).json({ message: "Request not found" });
    res.json(request);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch request" });
  }
};
