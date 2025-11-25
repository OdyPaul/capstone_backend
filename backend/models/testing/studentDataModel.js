// models/students/studentDataModel.js
const mongoose = require('mongoose');

let sconn = null;
try {
  const { getStudentsConn } = require('../../config/db');
  sconn = typeof getStudentsConn === 'function' ? getStudentsConn() : null;
} catch (_) {
  sconn = null;
}

const StudentDataSchema = new mongoose.Schema(
  {
    // MIS fields
    studentNumber: { type: String, required: true, unique: true }, // StudentNo
    lastName: { type: String, required: true }, // LastName
    firstName: { type: String, required: true }, // FirstName
    middleName: { type: String }, // MiddleName
    extName: { type: String }, // ExtName

    // convenience / display fields
    fullName: { type: String }, // "LASTNAME, Firstname M." or similar

    gender: { type: String }, // Gender
    permanentAddress: { type: String }, // Perm_Address
    major: { type: String }, // Major

    // optional college field used in filters
    college: { type: String },

    curriculum: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Curriculum',
    }, // CurriculumID

    // GWA fields
    collegeGwa: { type: Number }, // College_Gwa (canonical)
    gwa: { type: Number }, // legacy / compatibility

    dateAdmitted: { type: Date }, // DateAdmitted
    dateGraduated: { type: Date }, // DateGraduated
    placeOfBirth: { type: String }, // PlaceOfBirth
    dateOfBirth: { type: Date }, // DateOfBirth 

    collegeAwardHonor: { type: String }, // College_AwardHonor
    honor: { type: String }, // convenience alias

    entranceCredentials: { type: String }, // EntranceData_AdmissionCredential
    jhsSchool: { type: String }, // JHS_School
    shsSchool: { type: String }, // SHS_School
    highSchool: { type: String }, // convenience alias

    // Useful extras you already had on Student_Profiles
    program: { type: String }, // e.g. GEODEENG
    photoUrl: { type: String, default: null },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
      sparse: true,
    },
  },
  { timestamps: true }
);

const conn = sconn || mongoose.connection;

const StudentData =
  conn.models.Student_Data || conn.model('Student_Data', StudentDataSchema);

module.exports = StudentData;
