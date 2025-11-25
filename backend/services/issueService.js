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
  if (t.indexOf('tor') !== -1) return 'tor';
  if (t.indexOf('diploma') !== -1) return 'diploma';

  // avoid optional chaining
  const rawTypes = templateVc && templateVc.type;
  const arr = Array.isArray(rawTypes)
    ? rawTypes.map(function (s) {
        return String(s).toLowerCase();
      })
    : [];

  if (arr.some(function (s) { return s.indexOf('tor') !== -1; })) return 'tor';
  if (arr.some(function (s) { return s.indexOf('diploma') !== -1; })) return 'diploma';
  return 'diploma';
}

// ---------- core: create one issue ----------

async function createOneIssue(params) {
  params = params || {};

  const studentId = params.studentId;
  const studentNumber = params.studentNumber;
  const templateId = params.templateId;
  const type = params.type;
  const purpose = params.purpose;
  const expiration = params.expiration;
  const overrides = params.overrides;
  const amount = params.amount;
  const anchorNow = params.anchorNow;

  if (!templateId || !purpose) {
    const err = new Error('Missing templateId or purpose');
    err.status = 400;
    throw err;
  }

  if (!mongoose.isValidObjectId(templateId)) {
    const err = new Error('Invalid templateId');
    err.status = 400;
    throw err;
  }

  const template = await VcTemplate.findById(templateId);
  if (!template) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }

  const kind = inferKind(type, template.vc); // 'tor' | 'diploma'

  const ctx = await loadStudentContext({
    studentId: studentId,
    studentNumber: studentNumber,
    needGrades: kind === 'tor',
  });

  const student = ctx.student;
  const curriculumDoc = ctx.curriculumDoc;
  const grades = ctx.grades;

  // Prevent duplicate open issue per (student, template, purpose)
  const dup = await VcIssue.findOne({
    student: student._id,
    template: template._id,
    purpose: purpose,
    status: 'issued',
  }).lean();

  if (dup) {
    return { status: 'duplicate', issue: dup };
  }

  const data = buildSubjectData({
    template: template,
    student: student,
    curriculumDoc: curriculumDoc,
    kind: kind,
    overrides: overrides,
    grades: grades,
  });

  const price = Number.isFinite(Number(template.price))
    ? Number(template.price)
    : 250;

  let issue = await VcIssue.create({
    template: template._id,
    student: student._id,
    type: kind,
    purpose: purpose,
    data: data,
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

  return { status: 'created', issue: issue };
}

// ---------- batch issue creation (with optional seeding) ----------

async function createBatchIssue(params) {
  params = params || {};

  const recipients = Array.isArray(params.recipients) ? params.recipients : [];
  const studentDataRows = Array.isArray(params.studentDataRows)
    ? params.studentDataRows
    : [];
  const gradeRows = Array.isArray(params.gradeRows) ? params.gradeRows : [];
  const seedDb = !!params.seedDb;
  const templateId = params.templateId;
  const type = params.type;
  const purpose = params.purpose;
  const expiration = params.expiration;
  const anchorNow = params.anchorNow;
  const anchor = params.anchor;

  if (!templateId || !purpose) {
    const err = new Error('Missing templateId or purpose');
    err.status = 400;
    throw err;
  }

  // TEMP: always seed if we have rows, regardless of seedDb flag
  if (seedDb || studentDataRows.length || gradeRows.length) {
    await seedStudentsAndGrades({
      studentDataRows: studentDataRows,
      gradeRows: gradeRows,
    });
  }

  const results = [];

  // avoid nullish coalescing
  let effectiveAnchorNow = false;
  if (typeof anchorNow === 'boolean') {
    effectiveAnchorNow = anchorNow;
  } else if (typeof anchor === 'boolean') {
    effectiveAnchorNow = anchor;
  }

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    if (!r || !r.studentNumber) continue;

    const item = {
      studentNumber: String(r.studentNumber).trim(),
      templateId: templateId,
      type: type,
      purpose: purpose,
      expiration: expiration,
      anchorNow: effectiveAnchorNow,
      overrides: {
        fullName: r.fullName || undefined,
        program: r.program || undefined,
        dateGraduated: r.dateGraduated || undefined,
        dateOfBirth: r.dateOfBirth || undefined,
      },
    };


    // clean overrides so we don't send undefined keys
    const cleanOverrides = {};
    if (item.overrides.fullName) cleanOverrides.fullName = item.overrides.fullName;
    if (item.overrides.program) cleanOverrides.program = item.overrides.program;
    if (item.overrides.dateGraduated) {
      cleanOverrides.dateGraduated = item.overrides.dateGraduated;
    }
    item.overrides = cleanOverrides;

    try {
      const res = await createOneIssue(item);
      results.push(res);
    } catch (e) {
      console.error(
        'createOneIssue failed for',
        item.studentNumber,
        '-',
        e && e.message
      );
      results.push({
        status: 'error',
        error: (e && e.message) || String(e),
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
