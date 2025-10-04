const mongoose = require("mongoose");

const verificationRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true, // ✅ every request must belong to a user
    },
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
    DID: {
      type: String,
      required: true,
      unique: true, // ✅ permanent decentralized identifier
    },
    status: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VerificationRequest", verificationRequestSchema);
