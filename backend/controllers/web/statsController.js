// controllers/web/statsController.js
const asyncHandler = require("express-async-handler");
const Student  = require("../../models/students/studentModel");
const VcDraft  = require("../../models/web/vcDraft");
const SignedVC = require("../../models/web/signedVcModel");
const Payment  = require("../../models/web/paymentModel");

// 👇 Audit logs (web.login / web.logout)
const { getAuthConn } = require("../../config/db");
const AuditLogSchema  = require("../../models/common/auditLog.schema");

let AuditLogAuth = null;
function getAuditLogAuth() {
  try {
    const conn = getAuthConn();
    if (!conn) return null;
    AuditLogAuth = AuditLogAuth || conn.models.AuditLog || conn.model("AuditLog", AuditLogSchema);
    return AuditLogAuth;
  } catch {
    return null;
  }
}

// -------- Range helper --------
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
      return null;
    default:
      return new Date(now.getTime() - 7 * 864e5);
  }
}

// Day helpers (server timezone)
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d)   { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

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

// Split a [start,end] session across day boundaries, accumulating ms per day
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
    cur = new Date(cur.getTime() + 864e5);
  }
}

/**
 * Compute total logged ms for a user within range.
 * RULES:
 *  - Count only intervals that BEGIN with a `web.login`.
 *  - For a bounded range (e.g., "today"), IGNORE any session that started BEFORE `since`.
 *    (If user stayed logged in overnight, "today" remains 0 until they log in today.)
 */
async function computeLoggedMs(user, since) {
  const Audit = getAuditLogAuth();
  if (!Audit || !user) return 0;

  const userId = user._id;
  const userEmail = String(user.email || "").toLowerCase();

  // if caller provided since (client local midnight in UTC), respect it exactly
  const sinceFloor = since ? new Date(since) : null;

  // Fetch a bit earlier for ordering, but we enforce since-window on session start.
  const tsFilter = sinceFloor ? { $gte: new Date(sinceFloor.getTime() - 864e5) } : undefined;
  const query = {
    ...(tsFilter ? { ts: tsFilter } : {}),
    status: { $gte: 200, $lt: 300 },
    $or: [
      { routeTag: "web.login",  "meta.loginEmail": userEmail },
      { routeTag: "web.logout", actorId: userId },
    ],
  };

  const logs = await Audit.find(query).sort({ ts: 1 }).lean();

  const sessionsByDay = {}; // { 'YYYY-MM-DD': ms }
  let currentStart = null;
  const now = new Date();

  for (const row of logs) {
    const t = new Date(row.ts);

    if (row.routeTag === "web.login") {
      // Start counting only if login is inside the range (or no range).
      if (!sinceFloor || t >= sinceFloor) {
        currentStart = t;
      } else {
        currentStart = null;
      }
    } else if (row.routeTag === "web.logout") {
      if (currentStart) {
        const sessionStart = currentStart;
        const sessionEnd   = t;
        if (!sinceFloor || sessionStart >= sinceFloor) {
          addSessionSplitByDay(sessionsByDay, sessionStart, sessionEnd);
        }
      }
      currentStart = null;
    }
  }

  // Open session → only count if it started within the range
  if (currentStart) {
    if (!sinceFloor || currentStart >= sinceFloor) {
      addSessionSplitByDay(sessionsByDay, currentStart, now);
    }
  }

  // Sum over selected range (or all-time)
  let total = 0;
  if (sinceFloor) {
    const sinceKey = new Date(sinceFloor).toISOString().slice(0, 10);
    for (const [k, v] of Object.entries(sessionsByDay)) {
      if (k >= sinceKey) total += v;
    }
  } else {
    for (const v of Object.values(sessionsByDay)) total += v;
  }

  return total; // ms
}

// -------- Main overview --------
exports.getOverview = asyncHandler(async (req, res) => {
  // If client sends since (UTC ISO for client local midnight), prefer it.
  let since = null;
  if (req.query.since) {
    const d = new Date(req.query.since);
    if (!isNaN(d.getTime())) since = d;
  }
  if (!since) since = startForRange(req.query.range);

  // Totals (all-time)
  const [students, drafts, issuedActive, anchored] = await Promise.all([
    Student.countDocuments({}),
    VcDraft.countDocuments({ status: "draft" }),
    SignedVC.countDocuments({ status: "active" }),
    SignedVC.countDocuments({ "anchoring.state": "anchored" }),
  ]);

  // Revenue (prefer payments; fallback to 250 * issued in range, using the same issued-match as the pie)
  const paidMatch = { status: { $in: ["paid", "consumed"] } };
  if (since) paidMatch.paid_at = { $gte: since };

  const paymentsAgg = await Payment.aggregate([
    { $match: paidMatch },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  const issuedFallbackMatch = since
    ? {
        status: "active",
        $or: [
          { issued_at:   { $gte: since } },
          { activated_at:{ $gte: since } },
          { createdAt:   { $gte: since } },
        ],
      }
    : { status: "active" };

  const issuedCountForRevenue = await SignedVC.countDocuments(issuedFallbackMatch);
  const revenuePhp = paymentsAgg.length ? paymentsAgg[0].total : issuedCountForRevenue * 250;

  // Line: drafts created per day in range
  const reqMatch = since ? { createdAt: { $gte: since } } : {};
  const reqAgg = await VcDraft.aggregate([
    { $match: reqMatch },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const dayMap = reqAgg.reduce((m, r) => { m[r._id] = r.count; return m; }, {});

  // Fill range
  let fillStart = since;
  if (!fillStart) {
    if (reqAgg.length) fillStart = new Date(reqAgg[0]._id + "T00:00:00Z");
    else { fillStart = new Date(); fillStart.setHours(0, 0, 0, 0); }
  }
  const filled = fillDaysMap(dayMap, fillStart);
  const categories = Object.keys(filled);
  const series = [{ name: "Requests", data: categories.map(k => filled[k]) }];

  // Pie: range-aware counts
  const draftCountMatch = since ? { createdAt: { $gte: since } } : {};

  // Issued: count only if issued/activated/created today (in that priority order)
  const issuedCountMatch2 = since
    ? {
        status: "active",
        $or: [
          { issued_at:   { $gte: since } },    // prefer explicit
          { activated_at:{ $gte: since } },    // common alt
          { createdAt:   { $gte: since } },    // fallback
        ],
      }
    : { status: "active" };

  // Anchored: require state=anchored and anchored_at/anchoredAt/updatedAt/createdAt within range (in that priority order)
  const anchoredCountMatch = since
    ? {
        "anchoring.state": "anchored",
        $or: [
          { "anchoring.anchored_at": { $gte: since } },
          { "anchoring.anchoredAt":  { $gte: since } },
          { updatedAt:               { $gte: since } }, // helpful if timestamps are updated on state change
          { createdAt:               { $gte: since } }, // last resort for older docs
        ],
      }
    : { "anchoring.state": "anchored" };

  const [inRangeDrafts, inRangeIssued, inRangeAnchored] = await Promise.all([
    VcDraft.countDocuments(draftCountMatch),
    SignedVC.countDocuments(issuedCountMatch2),
    SignedVC.countDocuments(anchoredCountMatch),
  ]);

  // Logged time (start today only if login today)
  const loggedMs = await computeLoggedMs(req.user, since);
  const loggedHours = Math.round((loggedMs / 36e5) * 100) / 100;

  res.json({
    totals: { students, drafts, issuedActive, anchored, revenuePhp, loggedMs, loggedHours },
    line:   { categories, series },
    pie:    { labels: ["Draft", "Issued", "Anchored"], series: [inRangeDrafts, inRangeIssued, inRangeAnchored] },
  });
});

// -------- Explicit logged-time endpoint --------
// GET /api/web/stats/admin/stats/logged-time?range=today|1w|1m|3m|6m|all&since=<ISO>
exports.getLoggedTime = asyncHandler(async (req, res) => {
  let since = null;
  if (req.query.since) {
    const d = new Date(req.query.since);
    if (!isNaN(d.getTime())) since = d;
  }
  if (!since) since = startForRange(String(req.query.range || "today"));
  const loggedMs = await computeLoggedMs(req.user, since);
  const loggedHours = Math.round((loggedMs / 36e5) * 100) / 100;
  res.json({
    range: String(req.query.range || "today"),
    since: since ? since.toISOString() : null,
    loggedMs,
    loggedHours,
  });
});
