const express = require("express");
const router = express.Router();
const { protect, allowRoles } = require("../../middleware/authMiddleware");
const { getOverview, getLoggedTime } = require("../../controllers/web/statsController");

router.get(
  "/admin/stats/overview",
  protect,
  allowRoles("admin", "superadmin", "developer"),
  getOverview
);

router.get(
  "/admin/stats/logged-time",
  protect,
  allowRoles("admin", "superadmin", "developer"),
  getLoggedTime
);

module.exports = router;
