// services/anchorBatchService.js
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const SignedVC = require('../models/web/signedVcModel');
const AnchorBatch = require('../models/web/anchorBatchModel');
const { fromB64url } = require('../utils/vcCrypto');

// --- config + ABI
const ABI = require('../abi/MerkleAnchor.json');
const AMOY_RPC_URL  = (process.env.AMOY_RPC_URL || '').trim();
const CONTRACT_ADDR = (process.env.MERKLE_ANCHOR_ADDRESS || '').trim();
const SERVER_PK     = (process.env.SERVER_PRIVATE_KEY || '').trim();
const CHAIN_ID      = Number(process.env.CHAIN_ID || 80002);

function abiArray() { return Array.isArray(ABI) ? ABI : ABI.abi; }
function makeBatchId(prefix = 'batch') {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  return `${prefix}-${ts}`;
}
function leafFromDigestB64Url(digestB64Url) {
  return keccak256(fromB64url(digestB64Url));
}

// on-chain submit using ethers v6
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

  // Optional soft check
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

// build tree, call chain, persist results
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
    chain_id: CHAIN_ID,
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

module.exports = { commitBatch };
