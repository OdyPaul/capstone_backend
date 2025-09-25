const mongoose = require("mongoose");

const vcRequestSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    lrn: { 
      type: String,
       required: true 
    }, 
    type: {
      type: String,
      enum: ["Degree", "TOR"],
      required: true,
    },
    course: {
      type: String,
      required: true,
    },
    yearGraduated: {
      type: String, // optional since not all students know it
    },
    did: {
      type: String,
      default: () => "did:example:" + Math.random().toString(36).substring(2, 10), // random placeholder
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
