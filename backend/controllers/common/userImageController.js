// controllers/common/userImageController.js
const asyncHandler = require('express-async-handler');
const streamifier = require('streamifier');
const cloudinary = require('../../utils/cloudinary');
const UserImage = require('../../models/common/userImageModel');
const User = require('../../models/common/userModel');

/**
 * POST /api/images/user-profile/upload
 * Auth: any logged-in user (web or mobile)
 * Multipart field: file
 * Creates a staged image doc (ownerUser=null for now).
 */
exports.uploadUserProfileImage = asyncHandler(async (req, res) => {
  if (!req.file) { res.status(400); throw new Error('No file uploaded'); }

  // Optional lightweight content-type guard
  const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (req.file.mimetype && !okTypes.includes(req.file.mimetype)) {
    res.status(400); throw new Error('Unsupported image type');
  }

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'user_profiles' },
      (err, data) => (err ? reject(err) : resolve(data))
    );
    streamifier.createReadStream(req.file.buffer).pipe(stream);
  });

  const doc = await UserImage.create({
    url: result.secure_url,
    publicId: result.public_id,
    contentType: req.file.mimetype || null,
    ownerUser: null,             // will be attached later
    stagedBy: req.user?._id || null,
    purpose: 'profile',
  });

  res.status(201).json({ imageId: doc._id, url: doc.url });
});

/**
 * POST /api/images/user-profile/attach
 * Body: { imageId: string, userId?: string }
 * - Superadmin can attach to any user (for web user creation or updates)
 * - A normal user (mobile/web) can attach an image ONLY to themselves (userId omitted or equals req.user._id).
 * Sets user.profilePicture to the image URL and links image.ownerUser to that user.
 */
exports.attachUserProfileImage = asyncHandler(async (req, res) => {
  const { imageId, userId } = req.body || {};

  if (!imageId) { res.status(400); throw new Error('imageId is required'); }

  const img = await UserImage.findById(imageId);
  if (!img) { res.status(404); throw new Error('Image not found'); }
  if (img.purpose !== 'profile') { res.status(400); throw new Error('Image purpose mismatch'); }

  // Determine target user to attach to
  const targetUserId = userId || req.user._id;
  const targetUser = await User.findById(targetUserId);
  if (!targetUser) { res.status(404); throw new Error('Target user not found'); }

  const isSelf = req.user._id.toString() === targetUser._id.toString();
  const isSuperadmin = req.user.role === 'superadmin';

  if (!isSelf && !isSuperadmin) {
    res.status(403); throw new Error('Not authorized to attach profile image to another user');
  }

  // If image already linked to some user and it's not the same target, block reuse
  if (img.ownerUser && img.ownerUser.toString() !== targetUser._id.toString()) {
    res.status(409); throw new Error('Image already attached to another user');
  }

  // Attach to user and update the user's profilePicture URL
  img.ownerUser = targetUser._id;
  await img.save();

  targetUser.profilePicture = img.url;
  await targetUser.save();

  res.json({
    message: 'Profile image attached',
    userId: targetUser._id,
    imageUrl: img.url,
  });
});

/**
 * DELETE /api/images/user-profile/:id
 * Auth: owner of the image or superadmin
 * Deletes from Cloudinary and removes the record.
 * (If you don’t want deletion now, you can omit this route.)
 */
exports.deleteUserProfileImage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const img = await UserImage.findById(id);
  if (!img) { res.status(404); throw new Error('Image not found'); }

  const isOwner = img.ownerUser && img.ownerUser.toString() === req.user._id.toString();
  const isSuperadmin = req.user.role === 'superadmin';

  if (!isOwner && !isSuperadmin) {
    res.status(403); throw new Error('Not authorized to delete this image');
  }

  // Best-effort Cloudinary deletion
  try {
    await cloudinary.uploader.destroy(img.publicId);
  } catch (e) {
    // log only — we still remove the DB doc to avoid dangling references
    console.warn('Cloudinary destroy error:', e?.message);
  }

  // If owner is deleting the image that is currently set as their profilePicture,
  // optionally clear it from the User doc.
  if (img.ownerUser) {
    const owner = await User.findById(img.ownerUser);
    if (owner && owner.profilePicture === img.url) {
      owner.profilePicture = null;
      await owner.save();
    }
  }

  await img.deleteOne();
  res.json({ message: 'Profile image deleted' });
});
