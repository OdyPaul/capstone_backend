// controllers/web/anchorController.js
const asyncHandler = require('express-async-handler')
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const SignedVC = require('../../models/web/signedVcModel');
const AnchorBatch = require('../../models/web/anchorBatch');
const { fromB64url } = require('../../utils/vcCrypto');
;

async function submitToPolygon(merkleRootHex) {
  // TODO: replace with real ethers.js logic
  return '0xFAKE_' + merkleRootHex.slice(2, 10);
}

exports.mintBatch = asyncHandler(async (req, res) => {
  const docs = await SignedVC.find({
    'anchoring.state': 'unanchored',
    status: 'active'
  }).select('_id digest').lean();

  if (!docs.length) return res.json({ message: 'Nothing to anchor' });

  // Make leaves = keccak256(sha256digestBytes)
  const leafBuffers = docs.map(d => keccak256(fromB64url(d.digest)));
  const tree = new MerkleTree(leafBuffers, keccak256, { sortPairs: true });
  const root = '0x' + tree.getRoot().toString('hex');

  const txHash = await submitToPolygon(root);
  const batch_id = new Date().toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'

  await AnchorBatch.create({
    batch_id, merkle_root: root, tx_hash: txHash, chain_id: 137,
    count: docs.length, anchored_at: new Date()
  });

  // Save proof per VC
  const updates = docs.map((d, i) => {
    const leaf = leafBuffers[i];
    const proof = tree.getHexProof(leaf);    // ['0x..','0x..']
    return {
      updateOne: {
        filter: { _id: d._id },
        update: {
          $set: {
            'anchoring.state': 'anchored',
            'anchoring.batch_id': batch_id,
            'anchoring.tx_hash': txHash,
            'anchoring.anchored_at': new Date(),
            'anchoring.merkle_proof': proof
          }
        }
      }
    };
  });
  await SignedVC.bulkWrite(updates);

  res.json({ message: 'Anchored', batch_id, txHash });
});
