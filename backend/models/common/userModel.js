const mongoose = require('mongoose');
const { getAuthConn, getVcConn } = require('../../config/db');
const readonlyPlugin = require('../_plugins/readonly');

const baseSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },

  // Make password non-selectable so it never leaks with .lean()/.find()
  password: { type: String, required: true, select: false },

  // 🔹 add "cashier" here
  role: {
    type: String,
    enum: ['student', 'admin', 'superadmin', 'developer', 'cashier'],
    default: 'student',
  },

  verified: { type: String, enum: ['unverified', 'verified'], default: 'unverified' },

  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student_Data',
    unique: true,
    sparse: true,
  },
  profilePicture: { type: String, default: null },
}, {
  timestamps: true,
  discriminatorKey: 'kind',
  collection: 'users',
  toJSON: {
    virtuals: true,
    transform: (_doc, ret) => {
      delete ret.password;
      delete ret.__v;
      return ret;
    },
  },
});

baseSchema.pre('validate', function (next) {
  if (this.kind === 'mobile' && this.role !== 'student') {
    return next(new Error('Mobile users must have role=student'));
  }

  // 🔹 allow cashier as a web user
  if (
    this.kind === 'web' &&
    !['admin', 'superadmin', 'developer', 'cashier'].includes(this.role)
  ) {
    return next(
      new Error('Web users must be admin/superadmin/developer/cashier')
    );
  }

  next();
});

const AuthUser = getAuthConn().model('User', baseSchema);

const MobileUser = AuthUser.discriminator(
  'mobile',
  new mongoose.Schema({}, { _id: false })
);

const WebUser = AuthUser.discriminator(
  'web',
  new mongoose.Schema(
    {
      fullName: { type: String, trim: true },
      age: { type: Number, min: 0, max: 150 },
      address: { type: String, trim: true },
      gender: { type: String, enum: ['male', 'female', 'other'], default: 'other' },
      contactNo: { type: String, trim: true },
    },
    { _id: false }
  )
);

// Shadow copy on VC connection
const shadowSchemaVC = baseSchema.clone();
shadowSchemaVC.plugin(readonlyPlugin, { modelName: 'User (shadow on vcConn)' });
const vcConn = getVcConn();
try {
  vcConn.model('User');
} catch {
  vcConn.model('User', shadowSchemaVC);
}

module.exports = AuthUser;
module.exports.MobileUser = MobileUser;
module.exports.WebUser = WebUser;
