// controllers/web/paymentController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Payment = require('../../models/web/paymentModel');
const VcDraft = require('../../models/web/vcDraft');

exports.createRequest = asyncHandler(async (req, res) => {
  const {
    draftId,
    amount,
    currency = 'PHP',
    anchorNow = false,
    notes = ''
  } = req.body;

  if (!mongoose.isValidObjectId(draftId)) {
    res.status(400);
    throw new Error('Invalid draftId');
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    res.status(400);
    throw new Error('Invalid amount');
  }

  const draft = await VcDraft.findById(draftId).select('_id status');
  if (!draft) { res.status(404); throw new Error('Draft not found'); }
  if (draft.status !== 'draft') { res.status(409); throw new Error('Only drafts can receive payments'); }

  // If there’s already a PAID but unused payment, don’t open another one
  const paidOpen = await Payment.findOne({ draft: draft._id, status: 'paid', consumed_at: null });
  if (paidOpen) {
    return res.status(409).json({
      message: 'A paid, unused payment already exists for this draft',
      payment: paidOpen
    });
  }

  // Upsert a single PENDING payment per draft (idempotent)
  const result = await Payment.findOneAndUpdate(
    { draft: draft._id, status: 'pending' },
    {
      $setOnInsert: {
        amount: amt,
        currency,
        anchorNow: !!anchorNow,
        notes: (notes || '').trim()
      }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      rawResult: true // so we can see if it was inserted
    }
  );

  const pay = result.value; // the Payment doc
  const wasInserted = !!(result.lastErrorObject && result.lastErrorObject.upserted);

  // If it already existed (not inserted), allow updating amount/flags/notes
  if (!wasInserted) {
    let dirty = false;
    if (amt && amt > 0 && pay.amount !== amt) { pay.amount = amt; dirty = true; }
    if (typeof anchorNow === 'boolean' && pay.anchorNow !== !!anchorNow) { pay.anchorNow = !!anchorNow; dirty = true; }
    if (notes && notes.trim() && pay.notes !== notes.trim()) { pay.notes = notes.trim(); dirty = true; }
    if (dirty) await pay.save();
  }

  // Mirror payment info on the draft (helps listing/lookup)
  await VcDraft.updateOne(
    { _id: draft._id },
    { $set: { payment: pay._id, payment_tx_no: pay.tx_no } }
  );

  return res.status(wasInserted ? 201 : 200).json(pay);
});
// controllers/web/paymentController.js (replace markPaid)
exports.markPaid = asyncHandler(async (req, res) => {
  const { method='cash', notes='', receipt_no, receipt_date, amount, anchorNow } = req.body;

  const pay = await Payment.findById(req.params.id);
  if (!pay) { res.status(404); throw new Error('Payment not found'); }
  if (pay.status !== 'pending') { res.status(409); throw new Error('Payment is not pending'); }
  if (!receipt_no) { res.status(400); throw new Error('Receipt number is required'); }

  if (amount && amount > 0) pay.amount = amount;
  if (typeof anchorNow === 'boolean') pay.anchorNow = anchorNow;

  pay.status       = 'paid';
  pay.method       = method;
  pay.paid_at      = new Date();
  pay.confirmed_by = req.user._id;
  pay.receipt_no   = String(receipt_no).trim().toUpperCase();   // normalize
  pay.receipt_date = receipt_date ? new Date(receipt_date) : pay.paid_at;
  if (notes) pay.notes = notes;

  try {
    await pay.save();
  } catch (e) {
    if (e?.code === 11000 && e?.keyPattern?.receipt_no) {
      res.status(409);
      throw new Error('Receipt number already used');
    }
    throw e;
  }

  res.json(pay);
});

exports.markPaidByTx = asyncHandler(async (req, res) => {
  const { method='cash', notes='', receipt_no, receipt_date, amount, anchorNow } = req.body;

  const pay = await Payment.findOne({ tx_no: req.params.txNo });
  if (!pay) { res.status(404); throw new Error('Payment not found'); }
  if (pay.status !== 'pending') { res.status(409); throw new Error('Payment is not pending'); }
  if (!receipt_no) { res.status(400); throw new Error('Receipt number is required'); }

  if (amount && amount > 0) pay.amount = amount;
  if (typeof anchorNow === 'boolean') pay.anchorNow = anchorNow;

  pay.status       = 'paid';
  pay.method       = method;
  pay.paid_at      = new Date();
  pay.confirmed_by = req.user._id;
  pay.receipt_no   = String(receipt_no).trim().toUpperCase();   // normalize
  pay.receipt_date = receipt_date ? new Date(receipt_date) : pay.paid_at;
  if (notes) pay.notes = notes;

  try {
    await pay.save();
  } catch (e) {
    if (e?.code === 11000 && e?.keyPattern?.receipt_no) {
      res.status(409);
      throw new Error('Receipt number already used');
    }
    throw e;
  }

  res.json(pay);
});
exports.listPayments = asyncHandler(async (req, res) => {
  const { draft, status, tx_no } = req.query;
  const filter = {};
  if (draft && mongoose.isValidObjectId(draft)) filter.draft = draft;
  if (status) filter.status = status;
  if (tx_no) filter.tx_no = tx_no;

  const items = await Payment.find(filter)
    .populate({ path: 'draft', select: 'type purpose student status payment_tx_no' })
    .sort({ createdAt: -1 });

  res.json(items);
});

exports.voidPayment = asyncHandler(async (req, res) => {
  const pay = await Payment.findById(req.params.id);
  if (!pay) { res.status(404); throw new Error('Payment not found'); }
  if (pay.status === 'consumed') { res.status(409); throw new Error('Already used for issuance'); }

  pay.status = 'void';
  await pay.save();
  res.json(pay);
});

