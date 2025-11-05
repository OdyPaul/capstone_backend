// controllers/web/statsController.js
const asyncHandler = require("express-async-handler");
const Student   = require("../../models/students/studentModel");
const VcDraft   = require("../../models/web/vcDraft");
const SignedVC  = require("../../models/web/signedVcModel");
const Payment   = require("../../models/web/paymentModel");

// 👇 for audit logs (login/logout)
const { getAuthConn } = require("../../config/db");
const AuditLogSchema  = require("../../models/common/auditLog.schema");

let AuditLogAuth = null;
function getAuditLogAuth() {
  const conn = getAuthConn();
  if (!conn) return null;
  AuditLogAuth = AuditLogAuth || conn.models.AuditLog || conn.model("AuditLog", AuditLogSchema);
  return AuditLogAuth;
}

// -------- Range helper --------
// Returns a Date boundary or null (null = all-time)
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
      return null; // all-time (no filter)
    default:      return new Date(now.getTime() - 7 * 864e5);
  }
}

// Day helpers (server timezone)
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }

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

// Split a [start,end] session across day boundaries, accumulating ms per day (in out map)
function addSessionSplitByDay(outMap, start, end) {
  let s = new Date(start);
  let e = new Date(end);
  if (!(e > s)) return;

  let cur = startOfDay(s);
  const lastDay = startOfDay(e);

  while (cur <= lastDay) {
    const dayStart = cur;
    const dayEnd   = endOfDay(cur);
    const segStart = s > dayStart ? s : dayStart;
    const segEnd   = e < dayEnd   ? e : dayEnd;
    if (segEnd > segStart) {
      const key = dayStart.toISOString().slice(0, 10);
      outMap[key] = (outMap[key] || 0) + (segEnd - segStart);
    }
    cur = new Date(cur.getTime() + 864e5); // next day
  }
}

// Compute total logged ms for a user within range (cut at day boundaries)
async function computeLoggedMs(userId, since) {
  const Audit = getAuditLogAuth();
  if (!Audit || !userId) return 0;

  // Pull only login/logout events. If since is provided, include a 1-day buffer
  // so sessions that started yesterday and end today are handled.
  const tsFilter = since ? { $gte: new Date(since.getTime() - 864e5) } : undefined;
  const query = {
    actorId: userId,
    routeTag: { $in: ["web.login", "web.logout"] },
    ...(tsFilter ? { ts: tsFilter } : {}),
  };

  const logs = await Audit.find(query).sort({ ts: 1 }).lean();

  let sessionsByDay = {}; // { 'YYYY-MM-DD': ms }
  let currentStart = null;
  const now = new Date();

  for (const row of logs) {
    const tag = row.routeTag;
    const t   = new Date(row.ts);

    if (tag === "web.login") {
      // If already "logged in" (no logout yet), keep the earliest start
      currentStart = currentStart || t;
    } else if (tag === "web.logout") {
      if (currentStart && t > currentStart) {
        addSessionSplitByDay(sessionsByDay, currentStart, t);
      }
      currentStart = null;
    }
  }

  // Open session: count until now
  if (currentStart) {
    addSessionSplitByDay(sessionsByDay, currentStart, now);
  }

  // Sum over selected range (or all-time if since == null)
  let total = 0;
  if (since) {
    const sinceKey = startOfDay(since).toISOString().slice(0, 10);
    for (const [k, v] of Object.entries(sessionsByDay)) {
      if (k >= sinceKey) total += v;
    }
  } else {
    for (const v of Object.values(sessionsByDay)) total += v;
  }

  return total; // ms
}

exports.getOverview = asyncHandler(async (req, res) => {
  const since = startForRange(req.query.range);

  // ----- totals (all-time) -----
  const [students, drafts, issuedActive, anchored] = await Promise.all([
    Student.countDocuments({}),
    VcDraft.countDocuments({ status: "draft" }),
    SignedVC.countDocuments({ status: "active" }),
    SignedVC.countDocuments({ "anchoring.state": "anchored" }),
  ]);

  // ----- revenue (payments preferred; fallback 250/issued in range) -----
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
      } },
    { $sort: { _id: 1 } },
  ]);

  const dayMap = reqAgg.reduce((m, r) => { m[r._id] = r.count; return m; }, {});

  // When all-time (since === null), start filling from earliest bucket or today
  let fillStart = since;
  if (!fillStart) {
    if (reqAgg.length) fillStart = new Date(reqAgg[0]._id + "T00:00:00Z");
    else { fillStart = new Date(); fillStart.setHours(0,0,0,0); }
  }
  const filled = fillDaysMap(dayMap, fillStart);
  const categories = Object.keys(filled);
  const series = [{ name: "Requests", data: categories.map(k => filled[k]) }];

  // ----- pie (range-aware) -----
  const draftCountMatch    = since ? { createdAt: { $gte: since } } : {};
  const issuedCountMatch2  = since ? { createdAt: { $gte: since }, status: "active" } : { status: "active" };
  const anchoredCountMatch = since ? { "anchoring.anchored_at": { $gte: since } } : { "anchoring.state": "anchored" };

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

  // ----- logged time (ms) for current user over selected range -----
  const loggedMs = await computeLoggedMs(req.user?._id, since);
  const loggedHours = Math.round((loggedMs / 36e5) * 100) / 100; // 2 decimals

  res.json({
    totals: { students, drafts, issuedActive, anchored, revenuePhp, loggedMs, loggedHours },
    line:   { categories, series },
    pie:    { labels: ["Draft", "Issued", "Anchored"], series: [inRangeDrafts, inRangeIssued, inRangeAnchored] },
  });
});
