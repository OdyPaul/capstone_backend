const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const UnsignedVC = require('../../models/web/unsignedVc');       
const Student = require("../../models/students/studentModel");
// ---------- helpers ----------
function parseExpiration(expiration) {
  if (!expiration || expiration === 'N/A') return null;
  const d = new Date(expiration);
  if (isNaN(d)) throw new Error('Invalid expiration format');
  return d;
}

async function upsertOneDraft({ studentId, type, purpose, expiration }) {
  if (!studentId || !type || !purpose) {
    const err = new Error('Missing required fields');
    err.status = 400;
    throw err;
  }
  // quick ObjectId sanity check
  if (!mongoose.isValidObjectId(studentId)) {
    const err = new Error('Invalid studentId');
    err.status = 400;
    throw err;
  }

  // skip if same (student,type,purpose) already exists
  const existing = await UnsignedVC.findOne({ student: studentId, type, purpose }).populate('student');
  if (existing) {
    return { status: 'duplicate', draft: existing };
  }

  let doc = await UnsignedVC.create({
    student: studentId,
    type,
    purpose,
    expiration: parseExpiration(expiration),
  });

  doc = await doc.populate('student');
  return { status: 'created', draft: doc };
}

// ---------- controllers ----------

// POST /api/web/draft
// Accepts a single draft object or an array of drafts
const createUnsignedVC = asyncHandler(async (req, res) => {
  const body = req.body;

  // array payload
  if (Array.isArray(body)) {
    const results = [];
    for (const item of body) {
      try {
        const r = await upsertOneDraft(item);
        results.push(r);
      } catch (e) {
        results.push({
          status: 'error',
          error: e.message || 'Failed to create draft',
          input: item,
        });
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

  // single payload
  const { studentId, type, purpose, expiration } = body;
  const result = await upsertOneDraft({ studentId, type, purpose, expiration });

  if (result.status === 'duplicate') {
    return res.status(409).json({
      message: 'Draft already exists for this student with the same type and purpose',
      draft: result.draft,
    });
  }

  return res.status(201).json(result.draft);
});

// GET /api/web/draft?type=TOR&range=1m&program=BSIT&q=garcia
const getUnsignedVCs = asyncHandler(async (req, res) => {
  const { type, range, program, q } = req.query;

  const filter = {};
  if (type && type !== 'All') filter.type = type;

  if (range && range !== 'All') {
    let startDate = null;
    switch (range) {
      case 'today': { startDate = new Date(); startDate.setHours(0,0,0,0); break; }
      case '1w':   { startDate = new Date(); startDate.setDate(startDate.getDate() - 7); break; }
      case '1m':   { startDate = new Date(); startDate.setMonth(startDate.getMonth() - 1); break; }
      case '6m':   { startDate = new Date(); startDate.setMonth(startDate.getMonth() - 6); break; }
      default: break;
    }
    if (startDate) filter.createdAt = { $gte: startDate };
  }

  // populate + optional match on student's program / name / studentNumber
  const pop = {
    path: 'student',
    select: 'fullName studentNumber program dateGraduated',
  };

  // Use populate.match to filter by program in Mongo (not just in-memory)
  if (program && program !== 'All') {
    pop.match = { program: program };
  }

  let drafts = await UnsignedVC.find(filter).populate(pop);

  // If we used populate.match, some docs may have student = null; drop them
  if (program && program !== 'All') {
    drafts = drafts.filter(d => d.student);
  }

  // client text search (lightweight)
  if (q) {
    const needle = q.toLowerCase();
    drafts = drafts.filter(d => {
      const s = d.student || {};
      return (
        (s.fullName || '').toLowerCase().includes(needle) ||
        (s.studentNumber || '').toLowerCase().includes(needle) ||
        (d.type || '').toLowerCase().includes(needle) ||
        (s.program || '').toLowerCase().includes(needle)
      );
    });
  }

  res.json(drafts);
});

// DELETE /api/web/draft/:id
const deleteUnsignedVC = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400); throw new Error('Invalid draft id');
  }
  const doc = await UnsignedVC.findById(id);
  if (!doc) { res.status(404); throw new Error('Draft not found'); }
  await doc.deleteOne();
  res.json(doc);
});

module.exports = { createUnsignedVC, getUnsignedVCs, deleteUnsignedVC };
