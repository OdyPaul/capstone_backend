// controllers/mobile/studentLinkController.js
const asyncHandler = require('express-async-handler');
const Student = require('../../models/students/studentModel');
const User = require('../../models/common/userModel');

exports.linkStudentToCurrentUser = asyncHandler(async (req, res) => {
  // Only students link themselves
  if (req.user.role !== 'student' || req.user.kind !== 'mobile') {
    res.status(403); throw new Error('Only mobile students can link');
  }

  const { studentNumber } = req.body;
  if (!studentNumber) { res.status(400); throw new Error('studentNumber is required'); }

  const student = await Student.findOne({ studentNumber });
  if (!student) { res.status(404); throw new Error('Student not found'); }

  // Prevent stealing someone else’s student record
  if (student.userId && student.userId.toString() !== req.user._id.toString()) {
    res.status(409); throw new Error('Student record already linked to another user');
  }

  student.userId = req.user._id;
  await student.save();

  // Optionally mark user verified here if that’s your policy:
  await User.updateOne({ _id: req.user._id }, { $set: { verified: 'verified' } });

  res.json({ ok: true, studentId: student._id, linkedUser: req.user._id });
});
