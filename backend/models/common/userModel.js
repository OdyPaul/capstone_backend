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
      default: "student",  // mobile app users default to student
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
