// routes/mobile/activityRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/mobile/activityController');
const { protect } = require('../../middleware/authMiddleware'); // your auth middleware

router.get('/activity', protect, ctrl.listMine);

module.exports = router;
