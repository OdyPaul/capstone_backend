// controllers/web/draftVcController.js
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const VcDraft = require('../../models/web/vcDraft');
const VcTemplate = require('../../models/web/vcTemplate');
const Student = require('../../models/students/studentModel');
const { buildDataFromTemplate, validateAgainstTemplate } = require('../../utils/vcTemplate');

function parseExpiration(exp) {
  if (!exp || exp === 'N/A') return null;
  const d = new Date(exp);
  if (isNaN(d)) throw new Error('Invalid expiration format');
  return d;
}

async function createOneDraft({ studentId, templateId, type, purpose, expiration, overrides }) {
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

  const data = buildDataFromTemplate(template, student, overrides || {});
  const { valid, errors } = validateAgainstTemplate(template, data);
  if (!valid) {
    const e = new Error('Validation failed: ' + errors.join('; '));
    e.status = 400; throw e;
  }

  // Only block duplicates for ACTIVE drafts
  const existing = await VcDraft.findOne({
    student: studentId,
    template: templateId,
    purpose,
    status: 'draft',
  });
  if (existing) return { status: 'duplicate', draft: existing };

  let draft = await VcDraft.create({
    template: template._id,
    student: student._id,
    type,
    purpose,
    data,
    status: 'draft',
    expiration: parseExpiration(expiration),
  });

  draft = await draft
    .populate({ path: 'student', select: 'fullName studentNumber program dateGraduated' })
    .populate({ path: 'template', select: 'displayName version' });

  return { status: 'created', draft };
}

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

  const { studentId, templateId, type, purpose, expiration, overrides } = body;
  const result = await createOneDraft({ studentId, templateId, type, purpose, expiration, overrides });
  if (result.status === 'duplicate') {
    return res.status(409).json({ message: 'Draft already exists', draft: result.draft });
  }
  res.status(201).json(result.draft);
});

exports.getDrafts = asyncHandler(async (req, res) => {
  const { type, range, program, q, template } = req.query;
  const filter = {};
  if (type && type !== 'All') filter.type = type;
  if (template && mongoose.isValidObjectId(template)) filter.template = template;

  if (range && range !== 'All') {
    let start = null;
    if (range === 'today') { start = new Date(); start.setHours(0, 0, 0, 0); }
    if (range === '1w')   { start = new Date(Date.now() - 7 * 864e5); }
    if (range === '1m')   { start = new Date(); start.setMonth(start.getMonth() - 1); }
    if (range === '6m')   { start = new Date(); start.setMonth(start.getMonth() - 6); }
    if (start) filter.createdAt = { $gte: start };
  }

  const popStudent = { path: 'student', select: 'fullName studentNumber program dateGraduated' };
  if (program && program !== 'All') popStudent.match = { program };

  let drafts = await VcDraft.find(filter)
    .populate(popStudent)
    .populate({ path: 'template', select: 'name slug version' })
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
        (d.template?.name || '').toLowerCase().includes(needle)
      );
    });
  }

  res.json(drafts);
});

exports.deleteDraft = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid draft id'); }
  const doc = await VcDraft.findById(id);
  if (!doc) { res.status(404); throw new Error('Draft not found'); }
  await doc.deleteOne();
  res.json(doc);
});
