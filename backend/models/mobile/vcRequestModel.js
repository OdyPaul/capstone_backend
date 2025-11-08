const { getVcConn } = require("../../config/db"); // ✅ use VC conn
const conn = getVcConn();

const PURPOSES = [
  "employment",
  "further studies",
  "board examination / professional licensure",
  "scholarship / grant application",
  "personal / general reference",
  "overseas employment",
  "training / seminar",
];

const vcRequestSchema = new conn.Schema(
  {
    student:   { type: conn.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    studentId: { type: conn.Schema.Types.ObjectId, ref: "Student_Profiles", required: true, index: true },

    type:    { type: String, enum: ["TOR", "DIPLOMA"], required: true },
    purpose: { type: String, enum: PURPOSES, required: true }, // ✅

    status:    { type: String, enum: ["pending","approved","rejected","issued"], default: "pending", index: true },
    reviewedBy:{ type: conn.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, bufferCommands: false } // better surface connection issues
);

module.exports = conn.model("VCRequest", vcRequestSchema);
module.exports.PURPOSES = PURPOSES;
