// controllers/mobile/vcStatusController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const SignedVC = require('../../models/web/signedVcModel');

/* 🔔 Minimal audit (auth DB) */
const { getAuthConn } = require('../../config/db');
const AuditLogSchema = require('../../models/common/auditLog.schema');
let AuditLogAuth = null;
function getAuditLogAuth() {
  try {
    if (!AuditLogAuth) {
      const conn = getAuthConn();
      if (!conn) return null;
      AuditLogAuth = conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
    }
    return AuditLogAuth;
  } catch { return null; }
}
async function emitAnchoredOnce({ recipientId, vcId, digest, anchoredAt, chainId, txHash }) {
  try {
    const AuditLog = getAuditLogAuth();
    if (!AuditLog) return;
    const dedupeKey = `vc.anchored:${vcId}:${anchoredAt || 'na'}`;
    const exists = await AuditLog.exists({ 'meta.dedupeKey': dedupeKey });
    if (exists) return;

    await AuditLog.create({
      ts: new Date(),
      actorId: recipientId || null,
      actorRole: null,
      ip: null,
      ua: '',
      method: 'INTERNAL',
      path: '/mobile/vc/status',
      status: 200,
      latencyMs: 0,
      routeTag: 'vc.activity',
      query: {},
      params: {},
      bodyKeys: [],
      draftId: null,
      paymentId: null,
      vcId: vcId || null,
      meta: {
        event: 'vc.anchored',
        recipients: recipientId ? [String(recipientId)] : [],
        targetKind: 'vc',
        targetId: vcId || null,
        title: 'Credential anchored on-chain',
        body: 'Your credential anchoring is complete.',
        digest: digest || null,
        chain_id: chainId || null,
        tx_hash: txHash || null,
        dedupeKey,
      },
    });
  } catch { /* swallow */ }
}

const MAX_ITEMS = 500;

function slimAnchoring(a) {
  if (!a) return { state: 'unanchored' };
  const { state, tx_hash, batch_id, chain_id, anchored_at } = a || {};
  return {
    state: state || 'unanchored',
    tx_hash: tx_hash || null,
    batch_id: batch_id || null,
    chain_id: chain_id || null,
    anchored_at: anchored_at || null,
  };
}

/**
 * POST /api/mobile/vc/status
 * Body: { digests?: string[], ids?: string[], keys?: string[] }
 *
 * Returns: { count, results: [{ id, key, digest, anchoring, claimed_at, updated_at, notFound? }] }
 */
exports.statusBatch = asyncHandler(async (req, res) => {
  const { digests, ids, keys } = req.body || {};
  let mode = null;
  let list = [];

  if (Array.isArray(digests) && digests.length) {
    mode = 'digest'; list = digests.map(String);
  } else if (Array.isArray(ids) && ids.length) {
    mode = 'id'; list = ids.map(String);
  } else if (Array.isArray(keys) && keys.length) {
    mode = 'key'; list = keys.map(String);
  } else {
    return res.status(400).json({ message: 'Provide digests[] or ids[] or keys[]' });
  }

  list = Array.from(new Set(list)).slice(0, MAX_ITEMS);

  const isAdmin = !!(req.user && (req.user.isAdmin || req.user.role === 'admin'));
  const field = mode === 'digest' ? 'digest' : mode === 'id' ? '_id' : 'key';

  const filter = { [field]: { $in: list } };
  if (!isAdmin && req.user?._id) {
    filter.holder_user_id = req.user._id;
  }

  const sel = '_id key digest anchoring claimed_at updatedAt holder_user_id';

  if (mode === 'id') {
    const validIds = list.filter((x) => mongoose.Types.ObjectId.isValid(x));
    if (!validIds.length) {
      return res.json({ count: list.length, results: list.map((k) => ({ id: k, notFound: true })) });
    }
    filter._id = { $in: validIds };
    delete filter[field];
  }

  let docs = await SignedVC.find(filter).select(sel).lean();

  if (!docs.length && mode === 'digest') {
    const publicFilter = { digest: { $in: list } };
    docs = await SignedVC.find(publicFilter).select(sel).lean();
  }

  const indexKey = (d) => (mode === 'digest' ? d.digest : mode === 'id' ? String(d._id) : d.key);
  const m = new Map(docs.map((d) => [indexKey(d), d]));

  const results = list.map((k) => {
    const d = m.get(k);
    if (!d) return { [mode]: k, notFound: true };
    return {
      id: String(d._id),
      key: d.key || null,
      digest: d.digest,
      anchoring: slimAnchoring(d.anchoring),
      claimed_at: d.claimed_at || null,
      updated_at: d.updatedAt,
    };
  });

  // 🔔 Emit vc.anchored once for items that are anchored (only for holder)
  try {
    const me = req.user?._id ? String(req.user._id) : null;
    if (me) {
      for (const d of docs) {
        const a = d?.anchoring || {};
        if (String(d.holder_user_id || '') === me && (a.state || '').toLowerCase() === 'anchored') {
          await emitAnchoredOnce({
            recipientId: me,
            vcId: String(d._id),
            digest: d.digest || null,
            anchoredAt: a.anchored_at || null,
            chainId: a.chain_id || null,
            txHash: a.tx_hash || null,
          });
        }
      }
    }
  } catch { /* swallow */ }

  res.set('Cache-Control', 'no-store');
  res.json({ count: results.length, results });
});
