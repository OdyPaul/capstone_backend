// controllers/web/draftVcController.js
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const VcDraft = require('../../models/web/vcDraft');
const VcTemplate = require('../../models/web/vcTemplate');
const Student = require('../../models/students/studentModel');
const Payment = require('../../models/web/paymentModel');
const { buildDataFromTemplate, validateAgainstTemplate } = require('../../utils/vcTemplate');
// ⬇️ NEW: bring in defaults
const { getDefaults } = require('../../utils/templateDefaults');

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

// ⬇️ NEW: infer kind ('tor' | 'diploma') from template.vc.type or requested VC "type"
function inferKind(draftType, templateVc) {
  const t = String(draftType || '').toLowerCase();
  if (t.includes('tor')) return 'tor';
  if (t.includes('diploma')) return 'diploma';

  const arr = Array.isArray(templateVc?.type) ? templateVc.type.map(s => String(s).toLowerCase()) : [];
  if (arr.some(s => s.includes('tor'))) return 'tor';
  if (arr.some(s => s.includes('diploma'))) return 'diploma';

  // default
  return 'diploma';
}

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

  // ⬇️ NEW: decide which attributes to use (template’s, or the defaults)
  const hasAttrs = Array.isArray(template.attributes) && template.attributes.length > 0;
  const kind = inferKind(type, template.vc);
  const attributes = hasAttrs ? template.attributes : getDefaults(kind);

  // Build a local template “view” with effective attributes
  const effectiveTemplate = {
    ...template.toObject(),
    attributes,
  };

  // Build & validate data from the effective template
  const data = buildDataFromTemplate(effectiveTemplate, student, overrides || {});
  const { valid, errors } = validateAgainstTemplate(effectiveTemplate, data);
  if (!valid) {
    const e = new Error('Validation failed: ' + errors.join('; '));
    e.status = 400; throw e;
  }

  // Only block duplicates for ACTIVE draft
  const existing = await VcDraft.findOne({
    student: studentId,
    template: templateId,
    purpose,
    status: 'draft',
  });
  if (existing) return { status: 'duplicate', draft: existing };

  // Create the draft with a 7-digit client code
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

  // 💸 ensure there is exactly one PENDING payment for this draft (idempotent)
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

  // mirror payment info on draft for easy lookup
  if (pay) {
    draft.payment = pay._id;
    draft.payment_tx_no = pay.tx_no;
    await draft.save();
  }

  // populate for response
  draft = await draft
    .populate({ path: 'student', model: Student, select: 'fullName studentNumber program dateGraduated' })
    .populate({ path: 'template', select: 'name slug version price' });

  return { status: 'created', draft };
}
exports.deleteDraft = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid draft id'); }
  const doc = await VcDraft.findById(id);
  if (!doc) { res.status(404); throw new Error('Draft not found'); }
  await doc.deleteOne();
  res.json(doc);
});
