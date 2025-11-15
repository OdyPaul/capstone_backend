// controllers/web/draftVcController.js
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

const VcDraft = require('../../models/web/vcDraft');
const VcTemplate = require('../../models/web/vcTemplate');
const Student = require('../../models/students/studentModel');
const Payment = require('../../models/web/paymentModel');
const {
  buildDataFromTemplate,
  validateAgainstTemplate,
} = require('../../utils/vcTemplate');
const { getDefaults } = require('../../utils/templateDefaults');

/* -------------------------------------------------------------------------- */
/*                                   helpers                                  */
/* -------------------------------------------------------------------------- */

function parseExpiration(exp) {
  if (!exp || exp === 'N/A') return null;
  // Already a Date instance
  if (exp instanceof Date && !Number.isNaN(exp.getTime())) {
    return exp;
  }
  const d = new Date(exp);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid expiration format');
  }
  return d;
}

function genClientTx7() {
  return String(Math.floor(1000000 + Math.random() * 9000000));
}

async function createDraftWithUniqueTx(doc, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await VcDraft.create(doc);
    } catch (e) {
      const isDup =
        e?.code === 11000 &&
        (e?.keyPattern?.client_tx ||
          String(e?.message || '').includes('client_tx'));
      if (!isDup) throw e;
      // regenerate tx and retry
      doc.client_tx = genClientTx7();
    }
  }
  const err = new Error(
    'Could not generate a unique client_tx after several attempts'
  );
  err.status = 500;
  throw err;
}

/**
 * Infer high-level VC kind from type/template, used for default attributes.
 * Returns: 'tor' | 'diploma'
 */
function inferKind(draftType, templateVc) {
  const t = String(draftType || '').toLowerCase();
  if (t.includes('tor')) return 'tor';
  if (t.includes('diploma')) return 'diploma';

  const arr = Array.isArray(templateVc?.type)
    ? templateVc.type.map((s) => String(s).toLowerCase())
    : [];
  if (arr.some((s) => s.includes('tor'))) return 'tor';
  if (arr.some((s) => s.includes('diploma'))) return 'diploma';

  // default kind if nothing else matches
  return 'diploma';
}

/**
 * 🔍 Centralized loader for student + academic data used by templates.
 * IMPORTANT: adjust .populate(...) to match your actual schema.
 * Whatever `buildDataFromTemplate` expects (e.g. student.subjects, student.records)
 * must be made available here.
 */
async function loadStudentForDraft(studentId) {
  if (!mongoose.isValidObjectId(studentId)) {
    const err = new Error('Invalid studentId');
    err.status = 400;
    throw err;
  }

  const student = await Student.findById(studentId)
    // ⬇️ Adjust these to match your real schema
    .populate({
      path: 'subjects',             // e.g. Student.subjects[]
      options: { sort: { year: 1, semester: 1 } },
    })
    .populate('records')            // e.g. enrollment / grade records
    .populate('program')            // if program is a ref
    .lean();

  if (!student) {
    const e = new Error('Student not found');
    e.status = 404;
    throw e;
  }

  return student;
}

/* -------------------------------------------------------------------------- */
/*                                    core                                    */
/* -------------------------------------------------------------------------- */

/**
 * Main helper used by:
 *  - Web admin create draft API
 *  - Mobile VC request auto-draft (via exports.createDraftFromRequest)
 *
 * For consistency:
 *   - type is normalized to lowercase 'tor' | 'diploma' when stored.
 *   - purpose is stored as-is (already validated by routes / mobile controllers).
 */
async function createOneDraft({
  studentId,
  templateId,
  type,
  purpose,
  expiration,
  overrides,
  clientTx,
  anchorNow,
}) {
  if (!studentId || !templateId || !type || !purpose) {
    const err = new Error('Missing studentId, templateId, type or purpose');
    err.status = 400;
    throw err;
  }

  if (
    !mongoose.isValidObjectId(studentId) ||
    !mongoose.isValidObjectId(templateId)
  ) {
    const err = new Error('Invalid ObjectId');
    err.status = 400;
    throw err;
  }

  const template = await VcTemplate.findById(templateId);
  if (!template) {
    const e = new Error('Template not found');
    e.status = 404;
    throw e;
  }

  // Normalize draft type to lowercase for storage & default selection
  const normalizedType = String(type || '').trim().toLowerCase();
  const student = await loadStudentForDraft(studentId);

  const hasAttrs =
    Array.isArray(template.attributes) && template.attributes.length > 0;
  const kind = inferKind(normalizedType, template.vc);
  const attributes = hasAttrs ? template.attributes : getDefaults(kind);

  const effectiveTemplate = {
    ...template.toObject(),
    attributes,
  };

  // overrides can carry extra hints (e.g. TOR filters) if you need them
  const data = buildDataFromTemplate(
    effectiveTemplate,
    student,
    overrides || {}
  );
  const { valid, errors } = validateAgainstTemplate(effectiveTemplate, data);

  if (!valid) {
    const e = new Error('Validation failed: ' + errors.join('; '));
    e.status = 400;
    throw e;
  }

  // Prevent duplicate *draft* (same student/template/purpose) while status='draft'
  const existing = await VcDraft.findOne({
    student: studentId,
    template: templateId,
    purpose,
    status: 'draft',
  });

  if (existing) {
    return { status: 'duplicate', draft: existing };
  }

  // Create the draft
  let draft = await createDraftWithUniqueTx({
    template: template._id,
    student: student._id,
    type: normalizedType, // store normalized
    purpose,
    data,
    status: 'draft',
    expiration: parseExpiration(expiration),
    client_tx: clientTx || genClientTx7(),
  });

  // 💸 Ensure exactly one PENDING payment per draft (idempotent)
  const amount = Number.isFinite(Number(template.price))
    ? Number(template.price)
    : 250;

  const pay = await Payment.findOneAndUpdate(
    { draft: draft._id, status: 'pending' },
    {
      $setOnInsert: {
        amount,
        currency: 'PHP',
        anchorNow: !!anchorNow,
        notes: `Auto-created for draft ${draft._id} (client_tx ${draft.client_tx})`,
      },
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
    .populate({
      path: 'student',
      model: Student,
      select: 'fullName studentNumber program dateGraduated',
    })
    .populate({ path: 'template', select: 'name slug version price' });

  return { status: 'created', draft };
}

/* -------------------------------------------------------------------------- */
/*                               HTTP handlers                                */
/* -------------------------------------------------------------------------- */

exports.createDraft = asyncHandler(async (req, res) => {
  const body = req.body;

  // --- Batch mode -----------------------------------------------------------
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

    const created = results
      .filter((r) => r.status === 'created')
      .map((r) => r.draft);
    const duplicates = results
      .filter((r) => r.status === 'duplicate')
      .map((r) => r.draft);
    const errors = results.filter((r) => r.status === 'error');

    return res.status(created.length ? 201 : 200).json({
      createdCount: created.length,
      duplicateCount: duplicates.length,
      errorCount: errors.length,
      created,
      duplicates,
      errors,
    });
  }

  // --- Single draft mode ----------------------------------------------------
  const {
    studentId,
    templateId,
    type,
    purpose,
    expiration,
    overrides,
    clientTx,
    anchorNow,
  } = body;

  const result = await createOneDraft({
    studentId,
    templateId,
    type,
    purpose,
    expiration,
    overrides,
    clientTx,
    anchorNow,
  });

  if (result.status === 'duplicate') {
    return res
      .status(409)
      .json({ message: 'Draft already exists', draft: result.draft });
  }

  res.status(201).json(result.draft);
});

exports.getDrafts = asyncHandler(async (req, res) => {
  const { type, range, program, q, template, clientTx, tx, status } = req.query;

  const filter = {};

  if (type && type !== 'All') filter.type = type;
  if (template && mongoose.isValidObjectId(template)) filter.template = template;

  const hasStatusParam = Object.prototype.hasOwnProperty.call(
    req.query,
    'status'
  );
  if (hasStatusParam && status && status !== 'All') {
    filter.status = status; // 'draft' | 'signed' | 'anchored'
  }

  const txValue = clientTx || tx ? String(clientTx || tx).trim() : '';

  if (txValue) {
    filter.$or = [{ client_tx: txValue }, { payment_tx_no: txValue }];
  }

  if (range && range !== 'All') {
    let start = null;
    if (range === 'today') {
      start = new Date();
      start.setHours(0, 0, 0, 0);
    }
    if (range === '1w') {
      start = new Date(Date.now() - 7 * 864e5);
    }
    if (range === '1m') {
      start = new Date();
      start.setMonth(start.getMonth() - 1);
    }
    if (range === '6m') {
      start = new Date();
      start.setMonth(start.getMonth() - 6);
    }
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

  if (program && program !== 'All') {
    drafts = drafts.filter((d) => d.student);
  }

  if (q) {
    const needle = q.toLowerCase();
    drafts = drafts.filter((d) => {
      const s = d.student || {};
      return (
        (s.fullName || '').toLowerCase().includes(needle) ||
        (s.studentNumber || '').toLowerCase().includes(needle) ||
        (d.type || '').toLowerCase().includes(needle) ||
        (d.purpose || '').toLowerCase().includes(needle) ||
        (d.client_tx || '').toLowerCase().includes(needle) ||
        (d.payment_tx_no || '').toLowerCase().includes(needle) ||
        (d.template?.name || '').toLowerCase().includes(needle)
      );
    });
  }

  res.json(drafts);
});

exports.deleteDraft = asyncHandler(async (req, res) => {
  const draftId = req.params.id;

  const draft = await VcDraft.findById(draftId).select('_id status').lean();
  if (!draft) {
    res.status(404);
    throw new Error('Draft not found');
  }
  if (draft.status !== 'draft') {
    res.status(409);
    throw new Error('Cannot delete: draft is no longer in "draft" status');
  }

  const session = await VcDraft.db.startSession();
  let pendingDeleted = 0;

  try {
    await session.withTransaction(async () => {
      const blocking = await Payment.countDocuments({
        draft: draftId,
        status: { $in: ['paid', 'consumed'] },
      }).session(session);

      if (blocking > 0) {
        res.status(409);
        throw new Error(
          'Draft has paid/consumed payments. Void/refund first before deleting.'
        );
      }

      const delRes = await Payment.deleteMany({
        draft: draftId,
        status: 'pending',
      }).session(session);
      pendingDeleted = delRes.deletedCount || 0;

      const dRes = await VcDraft.deleteOne({
        _id: draftId,
        status: 'draft',
      }).session(session);

      if (dRes.deletedCount !== 1) {
        res.status(409);
        throw new Error(
          'Draft was not deleted (status changed or already removed).'
        );
      }
    });

    return res.json({
      _id: draftId,
      deleted: true,
      pending_payments_deleted: pendingDeleted,
      message: 'Draft deleted',
    });
  } finally {
    await session.endSession();
  }
});

/**
 * Internal helper so mobile VC requests can reuse the same logic.
 * Usage: const { createDraftFromRequest } = require('../web/draftVcController');
 */
exports.createDraftFromRequest = createOneDraft;
