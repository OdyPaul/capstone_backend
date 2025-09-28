const asyncHandler = require("express-async-handler");
const Avatar = require("../../models/mobile/avatarModel");

const BASE_URL = process.env.BASE_URL || process.env.API_URL || "http://127.0.0.1:5000";

// Upload avatar
const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file uploaded");
  }

  // Replace old one
  await Avatar.findOneAndDelete({ user: req.user.id });

  const avatar = await Avatar.create({
    user: req.user.id,
    filename: req.file.originalname,
    data: req.file.buffer,
    contentType: req.file.mimetype,
  });

  res.status(201).json({
    _id: avatar._id,
    filename: avatar.filename,
    contentType: avatar.contentType,
    uri: `${BASE_URL}/api/avatar/${avatar._id}`,
  });
});

// Get current user's avatar
const getAvatar = asyncHandler(async (req, res) => {
  const avatar = await Avatar.findOne({ user: req.user.id });
  if (!avatar) return res.json(null);

  res.json({
    _id: avatar._id,
    filename: avatar.filename,
    contentType: avatar.contentType,
    uri: `${BASE_URL}/api/avatar/${avatar._id}`,
  });
});

// Get avatar by id (binary)
const getAvatarById = asyncHandler(async (req, res) => {
  const avatar = await Avatar.findById(req.params.id);
  if (!avatar) {
    res.status(404);
    throw new Error("Avatar not found");
  }

  res.set("Content-Type", avatar.contentType);
  res.send(avatar.data);
});

// Delete avatar
const deleteAvatar = asyncHandler(async (req, res) => {
  const avatar = await Avatar.findOneAndDelete({
    _id: req.params.id,
    user: req.user.id,
  });

  if (!avatar) {
    res.status(404);
    throw new Error("Avatar not found");
  }

  res.json({ message: "Avatar deleted" });
});

module.exports = { uploadAvatar, getAvatar, getAvatarById, deleteAvatar };
