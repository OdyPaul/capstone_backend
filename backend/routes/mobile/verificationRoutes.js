const express = require("express");
const router = express.Router();
const verificationCtrl = require("../../controllers/mobile/verificationController");
const { protect, admin } = require("../../middleware/authMiddleware");

// Student submits
router.post("/", protect, verificationCtrl.createVerificationRequest);

// Student views *their own* request(s)
router.get("/my", protect, verificationCtrl.getMyVerificationRequests);

// Admin only
router.get("/", protect, admin, verificationCtrl.getVerificationRequests); // all requests
router.get("/:id", protect, admin, verificationCtrl.getVerificationRequestById); // single request
router.post("/:id/verify", protect, admin, verificationCtrl.verifyRequest);

module.exports = router;
