const asyncHandler = require('express-async-handler');
const Avatar = require('../models/avatarModel');

// @desc Upload or replace avatar
// @route POST /api/avatar
// @access Private
const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No file uploaded');
  }

  // Remove existing avatar for the user
  await Avatar.findOneAndDelete({ user: req.user.id });

  // Save new avatar directly from memory
  const avatar = await Avatar.create({
    user: req.user.id,
    filename: req.file.originalname, // original filename
    data: req.file.buffer,           // image data in memory
    contentType: req.file.mimetype,
  });

  res.status(201).json({
    _id: avatar.id,
    filename: avatar.filename,
    contentType: avatar.contentType,
  });
});

// @desc Get current user's avatar
// @route GET /api/avatar
// @access Private
const getAvatar = asyncHandler(async (req, res) => {
  const avatar = await Avatar.findOne({ user: req.user.id });
  if (!avatar) return res.json(null);

  res.json({
    _id: avatar.id,
    filename: avatar.filename,
    contentType: avatar.contentType,
    data: avatar.data.toString('base64'),
  });
});

// @desc Serve avatar binary
// @route GET /api/avatar/:id
// @access Private
const getAvatarById = asyncHandler(async (req, res) => {
  const avatar = await Avatar.findById(req.params.id);
  if (!avatar) {
    res.status(404);
    throw new Error('Avatar not found');
  }
  res.set('Content-Type', avatar.contentType);
  res.send(avatar.data);
});

// @desc Delete avatar
// @route DELETE /api/avatar/:id
// @access Private
const deleteAvatar = asyncHandler(async (req, res) => {
  const avatar = await Avatar.findOneAndDelete({
    _id: req.params.id,
    user: req.user.id,
  });
  if (!avatar) {
    res.status(404);
    throw new Error('Avatar not found');
  }
  res.json({ message: 'Avatar deleted' });
});

module.exports = {
  uploadAvatar,
  getAvatar,
  getAvatarById,
  deleteAvatar,
};
