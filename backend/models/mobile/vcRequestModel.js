const mongoose = require("mongoose");

const vcRequestSchema = new mongoose.Schema(
  {
    // Always tie requests to the account
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // reference to the logged-in user account
      required: true,
    },

    // The LRN typed by the student (not yet official)
    lrn: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: ["DEGREE", "TOR"],
      required: true,
    },
    course: {
      type: String,
      required: true,
    },
    yearGraduated: {
      type: String,
    },
    did: {
      type: String,
      default: () =>
        "did:example:" + Math.random().toString(36).substring(2, 10),
    },

    // Two image uploads
    faceImage: {
      filename: String,
      data: Buffer,
      contentType: String,
    },
    validIdImage: {
      filename: String,
      data: Buffer,
      contentType: String,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "issued"],
      default: "pending",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // admin user
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VCRequest", vcRequestSchema);
