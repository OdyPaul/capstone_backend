const VCRequest = require('../../models/mobile/VcRequest');
const Image = require('../../models/mobile/imageModel');

// Create VC request (student submits form referencing previously uploaded image IDs)
exports.createVCRequest = async (req, res) => {
  try {
    const { personal, education, selfieImageId, idImageId } = req.body;

    const vc = await VCRequest.create({
      user: req.user._id,
      personal,
      education,
      selfieImage: selfieImageId,
      idImage: idImageId,
      status: 'pending',
    });

    // Optionally attach ownerRequest to images
    if (selfieImageId) await Image.findByIdAndUpdate(selfieImageId, { ownerRequest: vc._id });
    if (idImageId) await Image.findByIdAndUpdate(idImageId, { ownerRequest: vc._id });

    return res.status(201).json(vc);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

// Admin verifies request; set status verified and mark images to expire in 30 days
const User = require('../../models/common/userModel'); // ✅ import user model

exports.verifyRequest = async (req, res) => {
  try {
    const { id } = req.params; // vc request id
    const vc = await VCRequest.findById(id);
    if (!vc) return res.status(404).json({ message: 'Not found' });

    vc.status = 'verified';
    vc.verifiedAt = new Date();
    await vc.save();

    // ✅ Also update the student's user account
    await User.findByIdAndUpdate(vc.user, { verified: 'verified' });

    // Set image expiration 30 days from now
    const expireDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const updates = [];
    if (vc.selfieImage) updates.push(Image.findByIdAndUpdate(vc.selfieImage, { expiresAt: expireDate }));
    if (vc.idImage) updates.push(Image.findByIdAndUpdate(vc.idImage, { expiresAt: expireDate }));
    await Promise.all(updates);

    return res.json({ message: 'Verified: user account and request updated, images scheduled to expire in 30 days' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};



// Get all VC Requests (with populated images)
exports.getVCRequests = async (req, res) => {
  try {
    const requests = await VCRequest.find()
      .populate("selfieImage", "url")
      .populate("idImage", "url")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch VC requests" });
  }
};

// Get single VC Request by ID
exports.getVCRequestById = async (req, res) => {
  try {
    const request = await VCRequest.findById(req.params.id)
      .populate("selfieImage", "url")
      .populate("idImage", "url");

    if (!request) return res.status(404).json({ message: "Request not found" });
    res.json(request);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch request" });
  }
};
