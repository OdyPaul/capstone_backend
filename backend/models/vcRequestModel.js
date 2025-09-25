const mongoose = require("mongoose");

const vcRequestSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: false,
    },
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
