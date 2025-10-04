const mongoose = require("mongoose");

const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please add a name"],
    },
    email: {
      type: String,
      required: [true, "Please add an email"],
      unique: true,
    },
    password: {
      type: String,
      required: [true, "Please add a password"],
    },
    role: {
      type: String,
      enum: ["student", "staff", "admin", "developer"],
      default: "student", // mobile app users default to student
    },
    did: {
      type: String,
      unique: true,
      sparse: true,
  },
    verified: {
      type: String,
      enum: ["unverified", "verified"],
      default: "unverified",
    },
  },
  { timestamps: true }
);

// ✅ Hook to remove "verified" field for non-students
userSchema.pre("save", function (next) {
  if (this.role !== "student") {
    this.verified = undefined;
  }
  next();
});

module.exports = mongoose.model("User", userSchema);
