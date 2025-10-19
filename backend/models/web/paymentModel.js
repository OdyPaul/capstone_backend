// models/web/paymentModel.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

function genTxNo() {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0,12); // YYYYMMDDHHMM
  const rand = Math.random().toString(36).slice(2,6).toUpperCase();
  return `TX-${ts}-${rand}`;
}

// models/web/paymentModel.js
const paymentSchema = new mongoose.Schema({
  tx_no:   { type: String, unique: true, default: genTxNo },
  draft:   { type: mongoose.Schema.Types.ObjectId, ref: 'VcDraft', required: true },

  amount:    { type: Number, required: true },
  currency:  { type: String, default: 'PHP' },
  anchorNow: { type: Boolean, default: false },

  status:  { type: String, enum: ['pending','paid','void','consumed'], default: 'pending' },
  method:  { type: String, enum: ['cash','gcash','card','other'], default: 'cash' },

  // ✅ add these
  receipt_no:   { type: String, default: null },
  receipt_date: { type: Date,   default: null },


  paid_at:      { type: Date, default: null },
  confirmed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  consumed_at:  { type: Date, default: null },

  notes: { type: String, default: '' },
}, { timestamps: true });


// One open 'pending' request per draft
paymentSchema.index(
  { draft: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'uniq_pending_per_draft' }
);

// One open 'paid & unused' per draft (optional but nice)
paymentSchema.index(
  { draft: 1, status: 1, consumed_at: 1 },
  { unique: true, partialFilterExpression: { status: 'paid', consumed_at: null }, name: 'uniq_paid_open_per_draft' }
);

module.exports = vconn.model('Payment', paymentSchema);
