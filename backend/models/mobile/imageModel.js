const mongoose = require("mongoose");

const imageSchema = mongoose.Schema(
  {
    url: {
      type: String,
      required: [true, "Image URL is required"],
    },
    publicId: {
      type: String,
      required: [true, "Cloudinary public_id is required"],
    },
    contentType: {
      type: String,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: null, // set when admin verifies: now + 30 days
    },
    meta: {
      type: mongoose.Schema.Types.Mixed, // optional extra info (e.g. { type: "selfie" | "id" })
    },
    ownerRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VCRequest", // reference to the verification request
    },
  },
  { timestamps: true }
);

// ✅ TTL index: removes doc from Mongo when expiresAt passes
// NOTE: This does NOT delete the file from Cloudinary — still need a cron job for that.
imageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Image", imageSchema);
