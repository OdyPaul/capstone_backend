// routes/rulesRoutes.js
const express = require('express');
const router = express.Router();
const { getRules, upsertRules } = require('../controllers/web/rulesController');

router.get('/', getRules);
router.post('/', upsertRules); // admin updates rules via React (POST or PUT)

module.exports = router;
