const express = require("express");
const router = express.Router();
const verificationCtrl = require("../../controllers/mobile/verificationController");
const { protect, admin } = require("../../middleware/authMiddleware");

// Student submits
router.post("/", protect, verificationCtrl.createVerificationRequest);

// Admin verifies
router.post("/:id/verify", protect, admin, verificationCtrl.verifyRequest);

// Admin views
router.get("/", protect, admin, verificationCtrl.getVerificationRequests);
router.get("/:id", protect, admin, verificationCtrl.getVerificationRequestById);

module.exports = router;
