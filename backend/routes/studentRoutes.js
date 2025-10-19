const express = require("express");
const router = express.Router();
const {
  getStudentPassing,
  getStudentTor,
  searchStudent,
  findStudent,
} = require("../controllers/web/studentController");
const { protect } = require("../middleware/authMiddleware");
const { getStudentSchema } = require("../controllers/web/studentController.extras");
// GET /api/student/passing
router.get("/passing", protect, getStudentPassing);

// GET /api/student/:id/tor
router.get("/:id/tor", protect, getStudentTor);

// GET /api/student/search?q=...
router.get("/search", protect, searchStudent);

// GET /api/student/:id
router.get("/:id", protect, findStudent);


router.get("/schema", protect, getStudentSchema);

module.exports = router;
