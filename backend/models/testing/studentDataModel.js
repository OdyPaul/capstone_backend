// models/students/studentDataModel.js
const mongoose = require('mongoose');

let sconn = null;
try {
  const { getStudentsConn } = require('../../config/db');
  sconn = typeof getStudentsConn === 'function' ? getStudentsConn() : null;
} catch (_) {
  sconn = null;
}

const StudentDataSchema = new mongoose.Schema({
  // MIS fields
  studentNumber: { type: String, required: true, unique: true }, // StudentNo
  lastName:      { type: String, required: true },               // LastName
  firstName:     { type: String, required: true },               // FirstName
  middleName:    { type: String },                               // MiddleName
  extName:       { type: String },                               // ExtName

  gender:        { type: String },                               // Gender
  permanentAddress: { type: String },                            // Perm_Address
  major:         { type: String },                               // Major

  curriculum:    { type: mongoose.Schema.Types.ObjectId, ref: 'Curriculum' }, // CurriculumID
  collegeGwa:    { type: Number },                               // College_Gwa

  dateAdmitted:  { type: Date },                                 // DateAdmitted
  dateGraduated: { type: Date },                                 // DateGraduated
  placeOfBirth:  { type: String },                               // PlaceOfBirth
  collegeAwardHonor: { type: String },                           // College_AwardHonor

  entranceCredentials: { type: String },                         // EntranceData_AdmissionCredential
  jhsSchool:     { type: String },                               // JHS_School
  shsSchool:     { type: String },                               // SHS_School

  // Useful extras you already had on Student_Profiles
  program:   { type: String },                                   // e.g. GEODEENG
  photoUrl:  { type: String, default: null },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
}, { timestamps: true });

const conn = sconn || mongoose.connection;

const StudentData =
  conn.models.Student_Data || conn.model('Student_Data', StudentDataSchema);

module.exports = StudentData;
