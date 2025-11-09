// controllers/web/anchorController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const SignedVC = require('../../models/web/signedVcModel');
const { enqueueAnchorNow } = require('../../queues/vc.queue');
const { commitBatch } = require('../../services/anchorBatchService');
const AnchorBatch = require('../../models/web/anchorBatchModel');
// -------------------- REQUEST “ANCHOR NOW” (queue only) --------------------
exports.requestNow = asyncHandler(async (req, res) => {
  const credId = req.params.credId;
  if (!mongoose.Types.ObjectId.isValid(credId)) {
    res.status(400); throw new Error('Invalid credential id');
  }

  const doc = await SignedVC.findById(credId).select('_id status anchoring');
  if (!doc) { res.status(404); throw new Error('Credential not found'); }
  if (doc.status !== 'active') { res.status(409); throw new Error('Credential not active'); }
  if (doc.anchoring?.state === 'anchored') {
    return res.json({ message: 'Already anchored', credential_id: credId, txHash: doc.anchoring.tx_hash });
  }
  if (doc.anchoring?.state === 'queued' && doc.anchoring?.queue_mode === 'now') {
    return res.json({ message: 'Already queued for NOW review', credential_id: credId });
  }

  await SignedVC.updateOne(
    { _id: credId, 'anchoring.state': { $ne: 'anchored' } },
    {
      $set: {
        'anchoring.state': 'queued',
        'anchoring.queue_mode': 'now',
        'anchoring.requested_at': new Date(),
        'anchoring.requested_by': req.user?._id || null,
        // ensure clean approval flags on enqueue
        'anchoring.approved_mode': null,
        'anchoring.approved_at': null,
        'anchoring.approved_by': null,
      }
    }
  );

  // enqueue worker job (doesn't anchor until confirmed)
  await enqueueAnchorNow(credId);

  res.json({ message: 'Queued for NOW review', credential_id: credId });
});

// -------------------- LIST QUEUE --------------------
exports.listQueue = asyncHandler(async (req, res) => {
  const { mode = 'all', approved = 'all' } = req.query;
  const filter = { 'anchoring.state': 'queued' };
  if (mode !== 'all') filter['anchoring.queue_mode'] = mode;
  if (approved === 'true')  filter['anchoring.approved_mode'] = { $in: ['single', 'batch'] };
  if (approved === 'false') filter['anchoring.approved_mode'] = null;

  const docs = await SignedVC.find(filter)
    .select('_id template_id status anchoring createdAt vc_payload digest')
    // Prefer most recently requested first, fall back to createdAt
    .sort({ 'anchoring.requested_at': -1, createdAt: -1 })
    .lean();

  res.json(docs);
});

// -------------------- APPROVE QUEUED --------------------
exports.approveQueued = asyncHandler(async (req, res) => {
  const { credIds = [], approved_mode } = req.body || {};
  if (!Array.isArray(credIds) || credIds.length === 0) { res.status(400); throw new Error('credIds required'); }
  if (!['single','batch'].includes(approved_mode)) { res.status(400); throw new Error('approved_mode must be "single" or "batch"'); }

  const result = await SignedVC.updateMany(
    { _id: { $in: credIds }, 'anchoring.state': 'queued' },
    { $set: { 'anchoring.approved_mode': approved_mode, 'anchoring.approved_at': new Date(), 'anchoring.approved_by': req.user?._id || null } }
  );

  res.json({ message: 'Approved', matched: result.matchedCount, modified: result.modifiedCount });
});

// -------------------- RUN SINGLE (one leaf) --------------------
exports.runSingle = asyncHandler(async (req, res) => {
  const credId = req.params.credId;
  if (!mongoose.Types.ObjectId.isValid(credId)) {
    res.status(400); throw new Error('Invalid credential id');
  }
  const doc = await SignedVC.findById(credId).select('_id digest status anchoring').lean();
  if (!doc) { res.status(404); throw new Error('Credential not found'); }
  if (doc.status !== 'active') { res.status(409); throw new Error('Credential not active'); }
  if (doc.anchoring?.state === 'anchored') {
    return res.json({ message:'Already anchored', credential_id: credId, txHash: doc.anchoring.tx_hash });
  }
  if (!(doc.anchoring?.state === 'queued' && doc.anchoring?.approved_mode === 'single')) {
    res.status(409); throw new Error('Credential not approved for single anchoring');
  }

  const { batch_id, txHash } = await commitBatch([doc], 'single');
  res.json({ message: 'Anchored (single)', batch_id, txHash });
});

// -------------------- MINT BATCH (cron/admin/EOD) --------------------
// Optional ?mode=now|batch|all (default: all)
//   - now:    only items with queue_mode === 'now'
//   - batch:  only items with queue_mode === 'batch'
//   - all:    any queue_mode (legacy behavior)
exports.mintBatch = asyncHandler(async (req, res) => {
  const { mode = 'all' } = req.query;
  const filter = {
    'anchoring.state': 'queued',
    'anchoring.approved_mode': 'batch',
    status: 'active',
  };
  if (mode === 'now')   filter['anchoring.queue_mode'] = 'now';
  if (mode === 'batch') filter['anchoring.queue_mode'] = 'batch';

  const docs = await SignedVC.find(filter).select('_id digest').lean();
  if (!docs.length) return res.json({ message: 'Nothing to anchor', count: 0 });

  const { batch_id, txHash, count } = await commitBatch(docs, 'batch');
  res.json({ message: 'Anchored (batch)', batch_id, txHash, count, mode });
});

// -------------------- LIST NON-"NOW" by AGE WINDOW --------------------
// GET /api/web/anchor/non-now?minDays=0&maxDays=15
// Returns ACTIVE, NOT ANCHORED, and NOT queued as 'now' within the age window.
exports.listNonNowAged = asyncHandler(async (req, res) => {
  const minDays = Math.max(0, Number(req.query.minDays ?? 0));
  const maxDays = req.query.maxDays == null ? null : Math.max(0, Number(req.query.maxDays));

  const now = new Date();
  const minTs = new Date(now.getTime() - minDays * 864e5);
  const createdLt = maxDays == null ? null : new Date(now.getTime() - maxDays * 864e5);

  const filter = {
    status: 'active',
    $or: [
      { 'anchoring.state': { $exists: false } },
      { 'anchoring.state': { $ne: 'anchored' } },
    ],
    $orQueue: [{ 'anchoring.queue_mode': { $exists: false } }, { 'anchoring.queue_mode': { $ne: 'now' } }],
  };

  // Mongo doesn't allow two $or at same level; re-compose:
  const realFilter = {
    status: 'active',
    $and: [
      { $or: [{ 'anchoring.state': { $exists: false } }, { 'anchoring.state': { $ne: 'anchored' } }] },
      { $or: [{ 'anchoring.queue_mode': { $exists: false } }, { 'anchoring.queue_mode': { $ne: 'now' } }] },
      { createdAt: { $lte: minTs } }, // age >= minDays
    ],
  };
  if (createdLt) {
    realFilter.$and.push({ createdAt: { $gte: createdLt } }); // age < maxDays
  }

  const docs = await SignedVC.find(realFilter)
    .select('_id template_id createdAt anchoring')
    .sort({ createdAt: -1 })
    .lean();

  res.json(docs);
});

exports.listBatches = asyncHandler(async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
  const chainId = req.query.chain_id ? Number(req.query.chain_id) : undefined;
  const filter = {};
  if (Number.isFinite(chainId)) filter.chain_id = chainId;

  const rows = await AnchorBatch.find(filter)
    .select('batch_id merkle_root tx_hash chain_id count anchored_at createdAt')
    .sort({ anchored_at: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  res.json(rows);
});

// Legacy alias
exports.mintNow = exports.requestNow;
