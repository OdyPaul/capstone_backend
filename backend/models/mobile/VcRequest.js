const mongoose = require("mongoose");

const vcRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    DID: {
      type: String,
      required: true, // ✅ comes from verified account
    },
    type: {
      type: String,
      enum: ["TOR", "DEGREE", "CERTIFICATE"],
      required: true,
    },
    program: {
      type: String,
      required: true, // e.g., BSIT
    },
    purpose: {
      type: String,
      required: true, // e.g., Employment, Further Studies
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "issued"],
      default: "pending",
    },
    issuedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VCRequest", vcRequestSchema);
