const mongoose = require("mongoose");

const vcRequestSchema = mongoose.Schema(
  {
    personal: {
      fullName: {
        type: String,
        required: [true, "Full name is required"],
      },
      address: {
        type: String,
        required: [true, "Address is required"],
      },
      birthPlace: {
        type: String,
        required: [true, "Birth place is required"],
      },
      birthDate: {
        type: Date,
        required: [true, "Birth date is required"],
      },
    },
    education: {
      highSchool: {
        type: String,
        required: [true, "High school name is required"],
      },
      admissionDate: {
        type: String,
        required: [true, "Admission date is required"],
      },
      graduationDate: {
        type: String,
        required: [true, "Graduation date is required"],
      },
    },
    selfieImage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Image",
      required: [true, "Selfie image is required"],
    },
    idImage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Image",
      required: [true, "Valid ID image is required"],
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
  { timestamps: true } // ✅ adds createdAt & updatedAt automatically
);

module.exports = mongoose.model("VCRequest", vcRequestSchema);
