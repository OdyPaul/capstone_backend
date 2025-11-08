const mongoose = require("mongoose");
// If you want VC data in the VC DB, uncomment and use getVcConn()
// const { getVcConn } = require("../../config/db");
// const conn = getVcConn();
const conn = mongoose; // or swap to vc conn above

const vcRequestSchema = new conn.Schema(
  {
    // account that created the request
    student: { type: conn.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // link to student profile by ObjectId reference
    studentId: { type: conn.Schema.Types.ObjectId, ref: "Student_Profiles", required: true, index: true },

    type: { type: String, enum: ["TOR", "DIPLOMA"], required: true },

    status: { type: String, enum: ["pending", "approved", "rejected", "issued"], default: "pending", index: true },

    reviewedBy: { type: conn.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = conn.model("VCRequest", vcRequestSchema);
