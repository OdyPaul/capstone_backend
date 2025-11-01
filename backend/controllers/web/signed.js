const SignedVC = require('../../models/web/signedVcModel');

// -------------------- LIST SIGNED (with claimed + range) --------------------
function startForRange(range) {
  const now = new Date();
  const d0 = new Date(now);
  d0.setHours(0, 0, 0, 0);
  switch (String(range || '').toLowerCase()) {
    case 'today': return d0;
    case '1w':    return new Date(now.getTime() - 7  * 864e5);
    case '1m':    return new Date(now.getTime() - 30 * 864e5);
    case '6m':    return new Date(now.getTime() - 182 * 864e5);
    default:      return null; // All
  }
}
function escRe(s='') { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

exports.listSigned = asyncHandler(async (req, res) => {
  const { q, status, anchorState, claimed, range } = req.query || {};

  const filter = {};

  // existing filters
  if (status) filter.status = status;                         // 'active' | 'revoked'
  if (anchorState) filter['anchoring.state'] = anchorState;   // 'unanchored' | 'queued' | 'anchored'

  // NEW: claimed filter
  if (typeof claimed === 'string') {
    const want = claimed.toLowerCase();
    if (want === 'true')  filter.claimed_at = { $ne: null };
    if (want === 'false') filter.$or = [{ claimed_at: { $exists: false } }, { claimed_at: null }];
  }

  // NEW: range filter on createdAt
  const since = startForRange(range);
  if (since) filter.createdAt = { $gte: since };

  // Search (server-side)
  if (q) {
    const rx = new RegExp(escRe(String(q).trim()), 'i');
    filter.$or = [
      ...(filter.$or || []),
      { template_id: rx },
      { 'vc_payload.credentialSubject.fullName': rx },
      { 'vc_payload.credentialSubject.studentNumber': rx },
    ];
  }

  const docs = await SignedVC.find(filter)
    .select('_id template_id status anchoring createdAt vc_payload claimed_at')
    .sort({ createdAt: -1 })
    .lean();

  res.json(docs);
});
