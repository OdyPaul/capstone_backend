// models/web/anchorBatchModel.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const anchorBatchSchema = new mongoose.Schema({
  batch_id:   { type: String, unique: true, required: true }, // 'YYYY-MM-DDTHH'
  merkle_root:{ type: String, unique: true, required: true },
  tx_hash:    { type: String, unique: true, required: true },
  chain_id:   { type: Number, default: 137 },
  count:      { type: Number, default: 0 },
  anchored_at:{ type: Date,   default: Date.now },
}, { timestamps: true });

// ❌ REMOVE these to avoid duplicate index warnings
// anchorBatchSchema.index({ merkle_root: 1 }, { unique: true });
// anchorBatchSchema.index({ tx_hash: 1 }, { unique: true });

module.exports = vconn.model('AnchorBatch', anchorBatchSchema);


