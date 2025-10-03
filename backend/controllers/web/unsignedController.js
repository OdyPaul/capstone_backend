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

// controllers/unsignedController.js
const getUnsignedVCs = asyncHandler(async (req, res) => {
  const { type, range } = req.query; // filters from frontend
  let filter = {};

  // 🔹 Filter by type (Degree, TOR)
  if (type && type !== "All") {
    filter.type = type;
  }

  // 🔹 Filter by date range
  if (range && range !== "All") {
    const now = new Date();
    let startDate;

    switch (range) {
      case "today":
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case "1w":
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case "1m":
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case "6m":
        startDate = new Date(now.setMonth(now.getMonth() - 6));
        break;
      default:
        startDate = null;
    }

    if (startDate) {
      filter.createdAt = { $gte: startDate };
    }
  }

  // 🔹 Query with filters
  const drafts = await UnsignedVC.find(filter).populate("student");
  res.json(drafts);
});


  module.exports = { createUnsignedVC, getUnsignedVCs };
