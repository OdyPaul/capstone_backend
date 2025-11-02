// models/common/userImageModel.js
const mongoose = require('mongoose');
const { getAuthConn } = require('../../config/db');

const conn = getAuthConn();

const userImageSchema = new mongoose.Schema({
  // Cloudinary info
  url:       { type: String, required: true },
  publicId:  { type: String, required: true, index: true },
  contentType: String,

  // Who owns/uses this image as profile (nullable while staging)
  ownerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

  // Who uploaded it (helpful for staging when creating another user)
  stagedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // For clarity / future extension
  purpose:   { type: String, enum: ['profile'], default: 'profile' },

  // Soft flag if you want to disable an image without deleting
  active:    { type: Boolean, default: true },
}, { timestamps: true });

// No TTL here — profile photos must persist.
module.exports = conn.model('UserImage', userImageSchema);
