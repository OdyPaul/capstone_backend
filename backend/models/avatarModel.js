const mongoose = require('mongoose');

const avatarSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    data: {
      type: Buffer,
      required: true,
    },
    contentType: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Avatar', avatarSchema);
