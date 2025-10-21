// models/web/claimTicket.js
const mongoose = require('mongoose');
const { getVcConn } = require('../../config/db');
const vconn = getVcConn();

const claimTicketSchema = new mongoose.Schema({
  token: { type: String, unique: true, required: true }, // random, ~128 bits
  cred_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SignedVC', required: true },
  expires_at: { type: Date, required: true },            // e.g., now + 7 days
  used_at: { type: Date, default: null },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // staff
}, { timestamps: true });

module.exports = vconn.model('ClaimTicket', claimTicketSchema);
