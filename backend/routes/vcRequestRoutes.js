const express = require("express");
const router = express.Router();
const {
  createVCRequest,
  getMyVCRequests,
  getAllVCRequests,
  reviewVCRequest,
} = require("../controllers/vcRequestController");
const { protect, admin } = require("../middleware/authMiddleware");

// Student creates request
router.post("/", protect, createVCRequest);

// Student views their requests
router.get("/mine", protect, getMyVCRequests);

// Admin views all requests
router.get("/", protect, admin, getAllVCRequests);

// Admin approves/rejects/issues
router.put("/:id", protect, admin, reviewVCRequest);

module.exports = router;
