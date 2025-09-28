  // controllers/unsignedController.js
  const UnsignedVC = require('../../models/web/unsignedVc');
  const asyncHandler = require('express-async-handler');

  const createUnsignedVC = asyncHandler(async (req, res) => {
    const { studentId, type, purpose, expiration } = req.body;

    if (!studentId || !type || !purpose || !expiration) {
      res.status(400);
      throw new Error("Missing required fields");
    }

    const expirationDate = new Date(expiration);
    if (isNaN(expirationDate)) {
      res.status(400);
      throw new Error("Invalid expiration format");
    }

    // ✅ Check if a draft already exists for this student/type/purpose
    const existingDraft = await UnsignedVC.findOne({
      student: studentId,
      type,
      purpose,
    });

    if (existingDraft) {
      return res.status(409).json({
        message: "Draft already exists for this student with the same type and purpose",
        draft: existingDraft,
      });
    }

    // ✅ If not existing, create a new draft
    const draft = await UnsignedVC.create({
      student: studentId,
      type,
      purpose,
      expiration: expirationDate,
    });

    res.status(201).json(draft);
  });

  const getUnsignedVCs = asyncHandler(async (req, res) => {
    const drafts = await UnsignedVC.find().populate('student');
    res.json(drafts);
  });

  module.exports = { createUnsignedVC, getUnsignedVCs };
