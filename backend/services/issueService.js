// services/issueService.js

const mongoose = require('mongoose');
const VcIssue = require('../models/testing/issueModel');
const VcTemplate = require('../models/web/vcTemplate');
const StudentData = require('../models/testing/studentDataModel');
const { loadStudentContext, seedStudentsAndGrades } = require('./studentService');
const { buildSubjectData } = require('./templateService');

// ---------- helpers ----------

function parseExpiration(exp) {
  if (!exp || exp === 'N/A') return null;
  if (exp instanceof Date && !Number.isNaN(exp.getTime())) return exp;

  const d = new Date(exp);
  if (Number.isNaN(d.getTime())) {
    const e = new Error('Invalid expiration format');
    e.status = 400;
    throw e;
  }
  return d;
}

// Normalize to 'tor' | 'diploma' from request or template.vc.type
function inferKind(typeParam, templateVc) {
  const t = String(typeParam || '').toLowerCase();
  if (t.includes('tor')) return 'tor';
  if (t.includes('diploma')) return 'diploma';

  const arr = Array.isArray(templateVc?.type)
    ? templateVc.type.map(s => String(s).toLowerCase())
    : [];
  if (arr.some(s => s.includes('tor'))) return 'tor';
  if (arr.some(s => s.includes('diploma'))) return 'diploma';
  return 'diploma';
}

// ---------- core: create one issue ----------

async function createOneIssue({
  studentId,
  studentNumber,
  templateId,
  type,
  purpose,
  expiration,
  overrides,
  amount,
  anchorNow,
}) {
  if (!templateId || !purpose) {
    throw Object.assign(new Error('Missing templateId or purpose'), {
      status: 400,
    });
  }
  if (!mongoose.isValidObjectId(templateId)) {
    throw Object.assign(new Error('Invalid templateId'), { status: 400 });
  }

  const template = await VcTemplate.findById(templateId);
  if (!template) {
    throw Object.assign(new Error('Template not found'), { status: 404 });
  }

  const kind = inferKind(type, template.vc); // 'tor' | 'diploma'

  const { student, curriculumDoc, grades } = await loadStudentContext({
    studentId,
    studentNumber,
    needGrades: kind === 'tor',
  });

  // Prevent duplicate open issue per (student, template, purpose)
  const dup = await VcIssue.findOne({
    student: student._id,
    template: template._id,
    purpose,
    status: 'issued',
  }).lean();

  if (dup) return { status: 'duplicate', issue: dup };

  const data = buildSubjectData({
    template,
    student,
    curriculumDoc,
    kind,
    overrides,
    grades,
  });

  const price = Number.isFinite(Number(template.price))
    ? Number(template.price)
    : 250;

  let issue = await VcIssue.create({
    template: template._id,
    student: student._id,
    type: kind,
    purpose,
    data,
    expiration: parseExpiration(expiration),
    amount: amount != null ? Number(amount) : price,
    currency: 'PHP',
    anchorNow: !!anchorNow,
    status: 'issued',
  });

  // Populate minimal fields for response (to match original behavior)
  issue = await issue
    .populate({
      path: 'student',
      model: StudentData,
      select:
        'studentNumber program dateGraduated firstName lastName middleName extName',
    })
    .populate({ path: 'template', select: 'name slug version price' });

  return { status: 'created', issue };
}

// ---------- batch issue creation (with optional seeding) ----------

async function createBatchIssue({
  recipients = [],
  studentDataRows = [],
  gradeRows = [],
  seedDb = false,
  templateId,
  type,
  purpose,
  expiration,
  anchorNow,
  anchor,
}) {
  if (!templateId || !purpose) {
    throw Object.assign(new Error('Missing templateId or purpose'), {
      status: 400,
    });
  }

  if (seedDb) {
    await seedStudentsAndGrades({ studentDataRows, gradeRows });
  }

  const results = [];
  const effectiveAnchorNow = (anchorNow ?? anchor) ?? false;

  for (const r of recipients || []) {
    if (!r || !r.studentNumber) continue;

    const item = {
      studentNumber: String(r.studentNumber).trim(),
      templateId,
      type,
      purpose,
      expiration,
      anchorNow: effectiveAnchorNow,
      overrides: {
        ...(r.fullName ? { fullName: r.fullName } : {}),
        ...(r.program ? { program: r.program } : {}),
        ...(r.dateGraduated ? { dateGraduated: r.dateGraduated } : {}),
      },
    };

    try {
      const res = await createOneIssue(item);
      results.push(res);
    } catch (e) {
      results.push({
        status: 'error',
        error: e.message,
        input: item,
      });
    }
  }

  return results;
}

module.exports = {
  createOneIssue,
  createBatchIssue,
};
