const UnsignedVC = require('../../models/web/unsignedVc');
const asyncHandler = require('express-async-handler');

// Create draft
const createUnsignedVC = asyncHandler(async (req, res) => {
  const { studentId, type, purpose, expiration } = req.body;

  if (!studentId || !type || !purpose) {
    res.status(400);
    throw new Error("Missing required fields");
  }

  // 🔹 expiration is optional
  let expirationDate = null;
  if (expiration && expiration !== "N/A") {
    const parsed = new Date(expiration);
    if (isNaN(parsed)) {
      res.status(400);
      throw new Error("Invalid expiration format");
    }
    expirationDate = parsed;
  }

  // ✅ Check if draft exists
  const existingDraft = await UnsignedVC.findOne({
    student: studentId,
    type,
    purpose,
  }).populate("student");

  if (existingDraft) {
    return res.status(409).json({
      message: "Draft already exists for this student with the same type and purpose",
      draft: existingDraft,
    });
  }

  // ✅ Create draft
  let draft = await UnsignedVC.create({
    student: studentId,
    type,
    purpose,
    expiration: expirationDate,
  });

  // ✅ Populate student before returning
  draft = await draft.populate("student");

  res.status(201).json(draft);
});

// Get drafts with filters
const getUnsignedVCs = asyncHandler(async (req, res) => {
  const { type, range } = req.query;
  let filter = {};

  // 🔹 Filter by type
  if (type && type !== "All") {
    filter.type = type;
  }

  // 🔹 Filter by date range
  if (range && range !== "All") {
    const now = new Date();
    let startDate;

    switch (range) {
      case "today":
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        break;
      case "1w":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "1m":
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case "6m":
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 6);
        break;
      default:
        startDate = null;
    }

    if (startDate) {
      filter.createdAt = { $gte: startDate };
    }
  }

  // ✅ Query with filters
  const drafts = await UnsignedVC.find(filter).populate("student");
  res.json(drafts);
});

module.exports = { createUnsignedVC, getUnsignedVCs };
