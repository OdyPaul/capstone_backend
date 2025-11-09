// models/web/anchorBatchModel.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const anchorBatchSchema = new mongoose.Schema(
  {
    // Unique per batch run
    batch_id:    { type: String, unique: true, required: true },

    // Root may repeat across chains; enforce uniqueness per chain
    merkle_root: { type: String, required: true },

    // On-chain tx hash is globally unique
    tx_hash:     { type: String, unique: true, required: true },

    // Always saved by the service (e.g., 80002 for Amoy)
    chain_id:    { type: Number, required: true },

    // Number of VC leaves in this batch
    count:       { type: Number, default: 0 },

    // When we anchored on-chain
    anchored_at: { type: Date, required: true },
  },
  { timestamps: true }
);

// ---- Indexes ----
// Fast lookups/sorting by time
anchorBatchSchema.index({ anchored_at: -1, createdAt: -1 });

// Ensure a root can’t be inserted twice on the same chain
anchorBatchSchema.index({ chain_id: 1, merkle_root: 1 }, { unique: true });

// Idempotent export to avoid OverwriteModelError on hot reloads / multi-imports
module.exports =
  vconn.models.AnchorBatch || vconn.model('AnchorBatch', anchorBatchSchema);
