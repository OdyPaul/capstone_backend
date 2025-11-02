// routes/mobile/students.js
const express = require('express');
const router = express.Router();
const { protect, allowRoles } = require('../../middleware/authMiddleware');
const { linkStudentToCurrentUser } = require('../../controllers/mobile/studentLinkController');

router.post('/students/link', protect, allowRoles('student'), linkStudentToCurrentUser);

module.exports = router;
