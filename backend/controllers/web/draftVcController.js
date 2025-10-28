// controllers/web/draftVcController.js
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const VcDraft = require('../../models/web/vcDraft');
const VcTemplate = require('../../models/web/vcTemplate');
const Student = require('../../models/students/studentModel');
const Payment = require('../../models/web/paymentModel');
const { buildDataFromTemplate, validateAgainstTemplate } = require('../../utils/vcTemplate');
const { getDefaults } = require('../../utils/templateDefaults');

// ---------- helpers ----------
function parseExpiration(exp) {
  if (!exp || exp === 'N/A') return null;
  const d = new Date(exp);
  if (isNaN(d)) throw new Error('Invalid expiration format');
  return d;
}

function genClientTx7() {
  return String(Math.floor(1000000 + Math.random() * 9000000)); // 7 digits
}

async function createDraftWithUniqueTx(doc, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await VcDraft.create(doc);
    } catch (e) {
      const dup = e?.code === 11000 && (e?.keyPattern?.client_tx || String(e?.message || '').includes('client_tx'));
      if (!dup) throw e;
      doc.client_tx = genClientTx7(); // regenerate and retry
    }
  }
  const err = new Error('Could not generate a unique client_tx after several attempts');
  err.status = 500;
  throw err;
}

// Infer kind ('tor' | 'diploma') from incoming draftType or template.vc.type
function inferKind(draftType, templateVc) {
  const t = String(draftType || '').toLowerCase();
  if (t.includes('tor')) return 'tor';
  if (t.includes('diploma')) return 'diploma';

  const arr = Array.isArray(templateVc?.type) ? templateVc.type.map(s => String(s).toLowerCase()) : [];
  if (arr.some(s => s.includes('tor'))) return 'tor';
  if (arr.some(s => s.includes('diploma'))) return 'diploma';

  return 'diploma';
}

// ---------- core ----------
async function createOneDraft({
  studentId, templateId, type, purpose, expiration, overrides, clientTx,
}) {
  if (!studentId || !templateId || !type || !purpose) {
    const err = new Error('Missing studentId, templateId, type or purpose');
    err.status = 400; throw err;
  }
  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(templateId)) {
    const err = new Error('Invalid ObjectId');
    err.status = 400; throw err;
  }

  const template = await VcTemplate.findById(templateId);
  if (!template) { const e = new Error('Template not found'); e.status = 404; throw e; }

  const student = await Student.findById(studentId).lean();
  if (!student) { const e = new Error('Student not found'); e.status = 404; throw e; }

  // Use template attributes if present; otherwise fallback to defaults
  const hasAttrs = Array.isArray(template.attributes) && template.attributes.length > 0;
  const kind = inferKind(type, template.vc);
  const attributes = hasAttrs ? template.attributes : getDefaults(kind);

  // Local effective template used for building/validating data
  const effectiveTemplate = {
    ...template.toObject(),
    attributes,
  };

  const data = buildDataFromTemplate(effectiveTemplate, student, overrides || {});
  const { valid, errors } = validateAgainstTemplate(effectiveTemplate, data);
  if (!valid) {
    const e = new Error('Validation failed: ' + errors.join('; '));
    e.status = 400; throw e;
  }

  // Prevent duplicate *draft* (same student/template/purpose) while status='draft'
  const existing = await VcDraft.findOne({
    student: studentId,
    template: templateId,
    purpose,
    status: 'draft',
  });
  if (existing) return { status: 'duplicate', draft: existing };

  // Create the draft
  let draft = await createDraftWithUniqueTx({
    template: template._id,
    student:  student._id,
    type,
    purpose,
    data,
    status: 'draft',
    expiration: parseExpiration(expiration),
    client_tx: clientTx || genClientTx7(),
  });

  // 💸 Ensure exactly one PENDING payment per draft (idempotent)
  const amount = Number.isFinite(Number(template.price)) ? Number(template.price) : 250;
  const pay = await Payment.findOneAndUpdate(
    { draft: draft._id, status: 'pending' },
    {
      $setOnInsert: {
        amount,
        currency: 'PHP',
        anchorNow: false,
        notes: `Auto-created for draft ${draft._id} (client_tx ${draft.client_tx})`
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // Mirror payment info on draft for easy lookup
  if (pay) {
    draft.payment = pay._id;
    draft.payment_tx_no = pay.tx_no;
    await draft.save();
  }

  // Populate for response
  draft = await draft
    .populate({ path: 'student', model: Student, select: 'fullName studentNumber program dateGraduated' })
    .populate({ path: 'template', select: 'name slug version price' });

  return { status: 'created', draft };
}

// ---------- routes handlers ----------
exports.createDraft = asyncHandler(async (req, res) => {
  const body = req.body;

  if (Array.isArray(body)) {
    const results = [];
    for (const item of body) {
      try {
        const r = await createOneDraft(item);
        results.push(r);
      } catch (e) {
        results.push({ status: 'error', error: e.message, input: item });
      }
    }
    const created = results.filter(r => r.status === 'created').map(r => r.draft);
    const duplicates = results.filter(r => r.status === 'duplicate').map(r => r.draft);
    const errors = results.filter(r => r.status === 'error');

    return res.status(created.length ? 201 : 200).json({
      createdCount: created.length,
      duplicateCount: duplicates.length,
      errorCount: errors.length,
      created,
      duplicates,
      errors,
    });
  }

  const { studentId, templateId, type, purpose, expiration, overrides, clientTx } = body;
  const result = await createOneDraft({ studentId, templateId, type, purpose, expiration, overrides, clientTx });
  if (result.status === 'duplicate') {
    return res.status(409).json({ message: 'Draft already exists', draft: result.draft });
  }
  res.status(201).json(result.draft);
});

exports.getDrafts = asyncHandler(async (req, res) => {
  const { type, range, program, q, template, clientTx } = req.query;
  const filter = {};
  if (type && type !== 'All') filter.type = type;
  if (template && mongoose.isValidObjectId(template)) filter.template = template;
  if (clientTx) filter.client_tx = String(clientTx);

  if (range && range !== 'All') {
    let start = null;
    if (range === 'today') { start = new Date(); start.setHours(0, 0, 0, 0); }
    if (range === '1w')   { start = new Date(Date.now() - 7 * 864e5); }
    if (range === '1m')   { start = new Date(); start.setMonth(start.getMonth() - 1); }
    if (range === '6m')   { start = new Date(); start.setMonth(start.getMonth() - 6); }
    if (start) filter.createdAt = { $gte: start };
  }

  let drafts = await VcDraft.find(filter)
    .populate({
      path: 'student',
      model: Student,
      select: 'fullName studentNumber program dateGraduated',
      ...(program && program !== 'All' ? { match: { program } } : {}),
    })
    .populate({ path: 'template', select: 'name slug version price' })
    .sort({ createdAt: -1 });

  if (program && program !== 'All') drafts = drafts.filter(d => d.student);

  if (q) {
    const needle = q.toLowerCase();
    drafts = drafts.filter(d => {
      const s = d.student || {};
      return (
        (s.fullName || '').toLowerCase().includes(needle) ||
        (s.studentNumber || '').toLowerCase().includes(needle) ||
        (d.type || '').toLowerCase().includes(needle) ||
        (d.purpose || '').toLowerCase().includes(needle) ||
        (d.client_tx || '').toLowerCase().includes(needle) ||
        (d.template?.name || '').toLowerCase().includes(needle)
      );
    });
  }

  res.json(drafts);
});


exports.deleteDraft = asyncHandler(async (req, res) => {
  const draftId = req.params.id;

  // 1) Basic existence + status check (only allow deleting true "draft")
  const draft = await UnsignedVC.findById(draftId).select('_id status').lean();
  if (!draft) { res.status(404); throw new Error('Draft not found'); }
  if (draft.status !== 'draft') {
    res.status(409);
    throw new Error('Cannot delete: draft is no longer in "draft" status');
  }

  // 2) Transaction to avoid race conditions with payments being marked paid
  const session = await UnsignedVC.db.startSession();
  try {
    let pendingDeleted = 0;

    await session.withTransaction(async () => {
      // 2a) Block if any non-pending payments exist
      const blocking = await Payment
        .countDocuments({ draft: draftId, status: { $in: ['paid', 'consumed'] } })
        .session(session);

      if (blocking > 0) {
        res.status(409);
        throw new Error('Draft has paid/consumed payments. Void/refund first before deleting.');
      }

      // 2b) Remove any pending payments tied to this draft
      const delRes = await Payment
        .deleteMany({ draft: draftId, status: 'pending' })
        .session(session);

      pendingDeleted = delRes.deletedCount || 0;

      // 2c) Delete the draft (still ensure it’s in "draft" state inside the txn)
      const dRes = await UnsignedVC
        .deleteOne({ _id: draftId, status: 'draft' })
        .session(session);

      if (dRes.deletedCount !== 1) {
        res.status(409);
        throw new Error('Draft was not deleted (status changed or already removed).');
      }
    });

    // 3) Success
    res.json({
      message: 'Draft deleted',
      draft_id: draftId,
      pending_payments_deleted: pendingDeleted
    });
  } finally {
    await session.endSession();
  }
});