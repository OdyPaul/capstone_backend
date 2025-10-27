// controllers/web/anchorController.js
const asyncHandler = require('express-async-handler');
const SignedVC = require('../../models/web/signedVcModel');
const { enqueueAnchorNow } = require('../../queues/vc.queue');
const { commitBatch } = require('../../services/anchorBatchService');

// -------------------- REQUEST “MINT NOW” (queue only) --------------------
exports.requestNow = asyncHandler(async (req, res) => {
  const credId = req.params.credId;
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
      }
    }
  );

  // enqueue the actual job so the worker can process it
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
    .sort({ createdAt: -1 })
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

// -------------------- MINT BATCH (cron/admin) --------------------
exports.mintBatch = asyncHandler(async (_req, res) => {
  // Only anchor items that were explicitly approved for batch
  const docs = await SignedVC
    .find({ 'anchoring.state': 'queued', 'anchoring.approved_mode': 'batch', status: 'active' })
    .select('_id digest')
    .lean();

  if (!docs.length) return res.json({ message: 'Nothing to anchor (no batch-approved items)' });

  const { batch_id, txHash, count } = await commitBatch(docs, 'batch');
  res.json({ message: 'Anchored (batch)', batch_id, txHash, count });
});

// Legacy alias
exports.mintNow = exports.requestNow;
