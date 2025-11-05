// routes/web/statsRoutes.js
const express = require("express");
const router = express.Router();
const { protect, allowRoles } = require("../../middleware/authMiddleware");
const { getOverview } = require("../../controllers/web/statsController");

router.get(
  "/admin/stats/overview",
  protect,
  allowRoles("admin", "superadmin", "developer"),
  getOverview
);

module.exports = router;
