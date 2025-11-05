// controllers/web/statsController.js
const asyncHandler = require("express-async-handler");
const Student   = require("../../models/students/studentModel");
const VcDraft   = require("../../models/web/vcDraft");
const SignedVC  = require("../../models/web/signedVcModel");
const Payment   = require("../../models/web/paymentModel");

// -------- Range helper --------
// Returns a Date boundary or null (null = all-time, no filter)
function startForRange(range) {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);

  switch (String(range || "").toLowerCase()) {
    case "today": return startOfToday;
    case "1w":    return new Date(now.getTime() - 7  * 864e5);
    case "1m":    return new Date(now.getTime() - 30 * 864e5);
    case "3m":    return new Date(now.getTime() - 90 * 864e5);
    case "6m":    return new Date(now.getTime() - 182 * 864e5);
    case "all":
    case "alltime":
      return null; // <-- important: no filter, not 1970
    default:      return new Date(now.getTime() - 7 * 864e5);
  }
}

// Fill missing days with 0s between since..today (YYYY-MM-DD keys)
function fillDaysMap(map, since) {
  const out = {};
  const d = new Date(since);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  while (d <= today) {
    const key = d.toISOString().slice(0, 10);
    out[key] = map[key] || 0;
    d.setDate(d.getDate() + 1);
  }
  return out;
}

exports.getOverview = asyncHandler(async (req, res) => {
  const since = startForRange(req.query.range);

  // ----- totals (always all-time) -----
  const [students, drafts, issuedActive, anchored] = await Promise.all([
    Student.countDocuments({}),
    VcDraft.countDocuments({ status: "draft" }),
    SignedVC.countDocuments({ status: "active" }),
    SignedVC.countDocuments({ "anchoring.state": "anchored" }),
  ]);

  // ----- revenue -----
  // Prefer actual payments in range; if none, fallback to fixed 250 per issued in range
  const paidMatch = { status: { $in: ["paid", "consumed"] } };
  if (since) paidMatch.paid_at = { $gte: since };

  const paymentsAgg = await Payment.aggregate([
    { $match: paidMatch },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  const issuedCountMatch = { status: "active" };
  if (since) issuedCountMatch.createdAt = { $gte: since };

  const issuedCount = await SignedVC.countDocuments(issuedCountMatch);
  const revenuePhp = paymentsAgg.length ? paymentsAgg[0].total : issuedCount * 250;

  // ----- line: requests per day -----
  const reqMatch = since ? { createdAt: { $gte: since } } : {};
  const reqAgg = await VcDraft.aggregate([
    { $match: reqMatch },
    { $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        count: { $sum: 1 },
      }
    },
    { $sort: { _id: 1 } },
  ]);

  const dayMap = reqAgg.reduce((m, r) => { m[r._id] = r.count; return m; }, {});

  // When all-time (since === null), start filling from earliest bucket (or today if none)
  let fillStart = since;
  if (!fillStart) {
    if (reqAgg.length) fillStart = new Date(reqAgg[0]._id + "T00:00:00Z");
    else { fillStart = new Date(); fillStart.setHours(0, 0, 0, 0); }
  }

  const filled = fillDaysMap(dayMap, fillStart);
  const categories = Object.keys(filled);
  const series = [{ name: "Requests", data: categories.map(k => filled[k]) }];

  // ----- pie: share of status in range (or all-time) -----
  const draftCountMatch    = since ? { createdAt: { $gte: since } } : {};
  const issuedCountMatch2  = since ? { createdAt: { $gte: since }, status: "active" } : { status: "active" };

  // Prefer anchored_at when present; otherwise fall back to state=anchored
  const anchoredCountMatch = since
    ? { "anchoring.anchored_at": { $gte: since } }
    : { "anchoring.state": "anchored" };

  const [inRangeDrafts, inRangeIssued, inRangeAnchored] = await Promise.all([
    VcDraft.countDocuments(draftCountMatch),
    SignedVC.countDocuments(issuedCountMatch2),
    SignedVC.countDocuments(anchoredCountMatch).catch(() =>
      SignedVC.countDocuments(
        since ? { createdAt: { $gte: since }, "anchoring.state": "anchored" }
              : { "anchoring.state": "anchored" }
      )
    ),
  ]);

  res.json({
    totals: { students, drafts, issuedActive, anchored, revenuePhp },
    line:   { categories, series },
    pie:    { labels: ["Draft", "Issued", "Anchored"], series: [inRangeDrafts, inRangeIssued, inRangeAnchored] },
  });
});
