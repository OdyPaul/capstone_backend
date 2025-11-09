// controllers/mobile/vcStatusController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const SignedVC = require('../../models/web/signedVcModel');

const MAX_ITEMS = 500;

// Keep the anchoring payload tiny for mobile sync calls
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
    mode = 'digest';
    list = digests.map(String);
  } else if (Array.isArray(ids) && ids.length) {
    mode = 'id';
    list = ids.map(String);
  } else if (Array.isArray(keys) && keys.length) {
    mode = 'key';
    list = keys.map(String);
  } else {
    return res.status(400).json({ message: 'Provide digests[] or ids[] or keys[]' });
  }

  // De-dupe + cap
  list = Array.from(new Set(list)).slice(0, MAX_ITEMS);

  const isAdmin = !!(req.user && (req.user.isAdmin || req.user.role === 'admin'));
  const field = mode === 'digest' ? 'digest' : mode === 'id' ? '_id' : 'key';

  // Base filter with per-user restriction
  const filter = { [field]: { $in: list } };
  if (!isAdmin && req.user?._id) {
    // Restrict to holder's own credentials
    filter.holder_user_id = req.user._id;
  }

  // Select only what we need (holder_user_id only used for filtering)
  const sel = '_id key digest anchoring claimed_at updatedAt holder_user_id';

  // If mode === 'id', validate ObjectIds
  if (mode === 'id') {
    const validIds = list.filter((x) => mongoose.Types.ObjectId.isValid(x));
    if (!validIds.length) {
      return res.json({ count: list.length, results: list.map((k) => ({ id: k, notFound: true })) });
    }
    filter._id = { $in: validIds };
    delete filter[field]; // avoid ambiguity
  }

  let docs = await SignedVC.find(filter).select(sel).lean();

  // ⬇️ If nothing matched but we searched by digest, fall back to a “public” digest lookup.
  //     This returns only slim anchoring info and never exposes PII beyond (id,key,digest).
  if (!docs.length && mode === 'digest') {
    const publicFilter = { digest: { $in: list } };
    docs = await SignedVC.find(publicFilter).select(sel).lean();
  }

  // Preserve request order
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

  res.set('Cache-Control', 'no-store');
  res.json({ count: results.length, results });
});
