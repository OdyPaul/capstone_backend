// models/mobile/verificationRequestModel.js
const mongoose = require("mongoose");
const { getAuthConn } = require("../../config/db");

const conn = getAuthConn();

const verificationRequestSchema = new mongoose.Schema(
  {
    // Who submitted this request
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Optional linkage to Student profile (upon verify)
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student_Profiles",
      default: null,
      index: true,
    },

    // KYC-like info supplied by the user
    personal: {
      fullName: { type: String, required: true },
      address: { type: String, required: true },
      birthPlace: { type: String, required: true },
      birthDate: { type: Date, required: true },
    },

    education: {
      highSchool: { type: String, required: true },
      admissionDate: { type: String, required: true },
      graduationDate: { type: String, required: true },
    },

    // Uploaded images
    selfieImage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Image",
      required: true,
    },
    idImage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Image",
      required: true,
    },

    // Review lifecycle
    status: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
      index: true,
    },

    verifiedAt: { type: Date, default: null },

    // For either verified or rejected
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },

    // If rejected
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true }
);

// Helpful compound index for listing
verificationRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = conn.model("VerificationRequest", verificationRequestSchema);
