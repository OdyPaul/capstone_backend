// controllers/web/signed.js
const asyncHandler = require('express-async-handler');
const SignedVC = require('../../models/web/signedVcModel');

// ---- helpers ----
function startForRange(range) {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0,0,0,0);
  switch (String(range || '').toLowerCase()) {
    case 'today': return startOfToday;
    case '1w':    return new Date(now.getTime() - 7  * 864e5);
    case '1m':    return new Date(now.getTime() - 30 * 864e5);
    case '6m':    return new Date(now.getTime() - 182 * 864e5);
    default:      return null; // All
  }
}
function escRe(s='') { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// -------------------- LIST SIGNED (with claimed + range + search) --------------------
exports.listSigned = asyncHandler(async (req, res) => {
  const { q, status, anchorState, claimed, range } = req.query || {};

  const filter = {};
  const and = [];

  if (status) filter.status = status;                       // 'active' | 'revoked'
  if (anchorState) filter['anchoring.state'] = anchorState; // 'unanchored' | 'queued' | 'anchored'

  // claimed=true|false
  if (typeof claimed === 'string') {
    const want = claimed.toLowerCase();
    if (want === 'true')  and.push({ claimed_at: { $ne: null } });
    if (want === 'false') and.push({ $or: [{ claimed_at: { $exists: false } }, { claimed_at: null }] });
  }

  // range on createdAt
  const since = startForRange(range);
  if (since) filter.createdAt = { $gte: since };

  // q: search name / student no. / template_id
  if (q) {
    const rx = new RegExp(escRe(String(q).trim()), 'i');
    and.push({
      $or: [
        { template_id: rx },
        { 'vc_payload.credentialSubject.fullName': rx },
        { 'vc_payload.credentialSubject.studentNumber': rx },
      ],
    });
  }

  if (and.length) filter.$and = and;

  const docs = await SignedVC.find(filter)
    .select('_id template_id status anchoring createdAt claimed_at vc_payload')
    .sort({ createdAt: -1 })
    .lean();

  res.json(docs);
});
