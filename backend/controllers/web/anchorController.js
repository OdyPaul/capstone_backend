// controllers/web/anchorController.js
const asyncHandler = require('express-async-handler');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const SignedVC = require('../../models/web/signedVcModel');
const AnchorBatch = require('../../models/web/anchorBatchModel');
const { fromB64url } = require('../../utils/vcCrypto');

// --- config + ABI (put your ABI file at backend/abi/MerkleAnchor.abi.json)
const ABI = require('../../abi/MerkleAnchor.json'); // raw array OR { abi: [...] }
const AMOY_RPC_URL  = (process.env.AMOY_RPC_URL || '').trim();
const CONTRACT_ADDR = (process.env.MERKLE_ANCHOR_ADDRESS || '').trim();
const SERVER_PK     = (process.env.SERVER_PRIVATE_KEY || '').trim(); // required for server-signed
const CHAIN_ID      = Number(process.env.CHAIN_ID || 80002);

function abiArray() { return Array.isArray(ABI) ? ABI : ABI.abi; }

function makeBatchId(prefix = 'batch') {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, ''); // YYYYMMDDHHMMSS
  return `${prefix}-${ts}`;
}

function leafFromDigestB64Url(digestB64Url) {
  return keccak256(fromB64url(digestB64Url));
}

// --- on-chain submit using ethers v6
async function submitToPolygon(merkleRootHex, batchId) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(merkleRootHex)) {
    throw new Error(`Invalid merkle root (bytes32 hex required): ${merkleRootHex}`);
  }
  if (!batchId) throw new Error('batchId is required');
  if (!AMOY_RPC_URL)  throw new Error('AMOY_RPC_URL not set');
  if (!CONTRACT_ADDR) throw new Error('MERKLE_ANCHOR_ADDRESS not set');
  if (!SERVER_PK)     throw new Error('SERVER_PRIVATE_KEY not set (server-signed mode)');

  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(AMOY_RPC_URL);
  const pk = SERVER_PK.startsWith('0x') ? SERVER_PK : ('0x' + SERVER_PK);
  const wallet = new ethers.Wallet(pk, provider);

  const contract = new ethers.Contract(CONTRACT_ADDR, abiArray(), wallet);
  const tx = await contract.anchor(merkleRootHex, batchId);
  const rcpt = await tx.wait();

  // Optional soft check: confirm first Anchored log matches inputs
  try {
    const iface = new ethers.Interface(abiArray());
    const log = rcpt.logs.find(l => l.address.toLowerCase() === CONTRACT_ADDR.toLowerCase());
    if (log) {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'Anchored') {
        const [rootFromChain, batchFromChain] = parsed.args;
        if (String(rootFromChain).toLowerCase() !== merkleRootHex.toLowerCase()) throw new Error('Anchored root mismatch');
        if (String(batchFromChain) !== batchId) throw new Error('Anchored batchId mismatch');
      }
    }
  } catch { /* ignore soft-assert */ }

  return rcpt.hash;
}

// --- build tree, call chain, persist results
async function commitBatch(docs, label = 'batch') {
  const leafBuffers = docs.map(d => leafFromDigestB64Url(d.digest));
  const tree = new MerkleTree(leafBuffers, keccak256, { sortPairs: true });
  const root = '0x' + tree.getRoot().toString('hex');

  const batch_id = makeBatchId(label);
  const txHash = await submitToPolygon(root, batch_id);

  await AnchorBatch.create({
    batch_id,
    merkle_root: root,
    tx_hash: txHash,
    chain_id: CHAIN_ID,      // write the actual chain you used (80002 on Amoy)
    count: docs.length,
    anchored_at: new Date(),
  });

  const updates = docs.map((d, i) => {
    const leaf = leafBuffers[i];
    const proof = tree.getHexProof(leaf);
    return {
      updateOne: {
        filter: { _id: d._id },
        update: {
          $set: {
            'anchoring.state': 'anchored',
            'anchoring.batch_id': batch_id,
            'anchoring.tx_hash': txHash,
            'anchoring.chain_id': CHAIN_ID,
            'anchoring.anchored_at': new Date(),
            'anchoring.merkle_proof': proof,
            'anchoring.queue_mode': 'none',
            'anchoring.approved_mode': null,
            'anchoring.approved_at': null,
            'anchoring.approved_by': null,
          }
        }
      }
    };
  });
  await SignedVC.bulkWrite(updates);

  return { batch_id, txHash, count: docs.length };
}

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
    { $set: {
        'anchoring.state': 'queued',
        'anchoring.queue_mode': 'now',
        'anchoring.requested_at': new Date(),
        'anchoring.requested_by': req.user?._id || null,
    } }
  );
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
  if (doc.anchoring?.state === 'anchored') return res.json({ message:'Already anchored', credential_id: credId, txHash: doc.anchoring.tx_hash });
  if (!(doc.anchoring?.state === 'queued' && doc.anchoring?.approved_mode === 'single')) {
    res.status(409); throw new Error('Credential not approved for single anchoring');
  }
  const { batch_id, txHash } = await commitBatch([doc], 'single');
  res.json({ message: 'Anchored (single)', batch_id, txHash });
});

// -------------------- MINT BATCH (cron/admin) --------------------
exports.mintBatch = asyncHandler(async (_req, res) => {
  const queuedForBatch = await SignedVC
    .find({ 'anchoring.state': 'queued', 'anchoring.approved_mode': 'batch', status: 'active' })
    .select('_id digest').lean();
  const unanchored = await SignedVC
    .find({ 'anchoring.state': 'unanchored', status: 'active' })
    .select('_id digest').lean();

  const docs = [...queuedForBatch, ...unanchored];
  if (!docs.length) return res.json({ message: 'Nothing to anchor' });

  const { batch_id, txHash, count } = await commitBatch(docs, 'batch');
  res.json({ message: 'Anchored (batch)', batch_id, txHash, count });
});

// Legacy alias
exports.mintNow = exports.requestNow;

module.exports.commitBatch = commitBatch; // 👈 export so the worker can call it
