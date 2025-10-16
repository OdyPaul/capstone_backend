// config/db.js
const mongoose = require('mongoose');

let authConn, studentsConn, vcConn;

async function connectAll() {
  // Node MongoDB v4+: no need for useNewUrlParser/useUnifiedTopology
  const commonOpts = {};

  authConn     = await mongoose.createConnection(process.env.MONGO_URI_AUTH, commonOpts).asPromise();
  studentsConn = await mongoose.createConnection(process.env.MONGO_URI_STUDENTS, commonOpts).asPromise();
  vcConn       = await mongoose.createConnection(process.env.MONGO_URI_VC, commonOpts).asPromise();

  console.log('Mongo connected:', {
    auth: authConn.name,
    students: studentsConn.name,
    vc: vcConn.name,
  });

  return { authConn, studentsConn, vcConn };
}

const getAuthConn     = () => authConn;
const getStudentsConn = () => studentsConn;
const getVcConn       = () => vcConn;

module.exports = { connectAll, getAuthConn, getStudentsConn, getVcConn };
