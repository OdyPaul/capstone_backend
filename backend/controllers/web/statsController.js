// controllers/web/statsController.js
const asyncHandler = require("express-async-handler");
const Student = require("../../models/students/studentModel");
const VcDraft = require("../../models/web/vcDraft");
const SignedVC = require("../../models/web/signedVcModel");
const Payment = require("../../models/web/paymentModel");

// Range helper
function startForRange(range) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  switch (String(range || "").toLowerCase()) {
    case "today":
      return startOfToday;
    case "1w":
      return new Date(now.getTime() - 7 * 864e5);
    case "1m":
      return new Date(now.getTime() - 30 * 864e5);
    case "3m":
      return new Date(now.getTime() - 90 * 864e5);
    case "6m":
      return new Date(now.getTime() - 180 * 864e5);
    case "all":
    case "alltime":
      return new Date(0); // All time
    default:
      return new Date(now.getTime() - 7 * 864e5); // default 1 week
  }
}

// Fill missing days with 0s between since..today (YYYY-MM-DD keys)
function fillDaysMap(map, since) {
  const out = {};
  const d = new Date(since);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  while (d <= today) {
    const key = d.toISOString().slice(0, 10);
    out[key] = map[key] || 0;
    d.setDate(d.getDate() + 1);
  }
  return out;
}

exports.getOverview = asyncHandler(async (req, res) => {
  const since = startForRange(req.query.range);

  // ----- totals (fast counts) -----
  const [students, drafts, issuedActive, anchored] = await Promise.all([
    Student.countDocuments({}),
    VcDraft.countDocuments({ status: "draft" }),
    SignedVC.countDocuments({ status: "active" }),
    SignedVC.countDocuments({ "anchoring.state": "anchored" }),
  ]);

  // ----- revenue (based on issued credentials) -----
  const issuedCount = await SignedVC.countDocuments({
    status: "active",
    createdAt: { $gte: since },
  });

  const paymentsAgg = await Payment.aggregate([
    {
      $match: {
        status: { $in: ["paid", "consumed"] },
        paid_at: { $gte: since },
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  // Default: 250 per issued unless specific payments exist
  const revenuePhp = paymentsAgg.length
    ? paymentsAgg[0].total
    : issuedCount * 250;

  // ----- line: requests per day -----
  const reqAgg = await VcDraft.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const dayMap = reqAgg.reduce((m, r) => ((m[r._id] = r.count), m), {});
  const filled = fillDaysMap(dayMap, since);
  const categories = Object.keys(filled);
  const series = [{ name: "Requests", data: categories.map((k) => filled[k]) }];

  // ----- pie: share of status -----
  const [inRangeDrafts, inRangeIssued, inRangeAnchored] = await Promise.all([
    VcDraft.countDocuments({ createdAt: { $gte: since } }),
    SignedVC.countDocuments({ createdAt: { $gte: since }, status: "active" }),
    SignedVC.countDocuments({ "anchoring.anchored_at": { $gte: since } }).catch(() =>
      SignedVC.countDocuments({
        createdAt: { $gte: since },
        "anchoring.state": "anchored",
      })
    ),
  ]);

  res.json({
    totals: { students, drafts, issuedActive, anchored, revenuePhp },
    line: { categories, series },
    pie: {
      labels: ["Draft", "Issued", "Anchored"],
      series: [inRangeDrafts, inRangeIssued, inRangeAnchored],
    },
  });
});
