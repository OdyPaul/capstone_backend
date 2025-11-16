// controllers/testing/issueCredentialController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const VcIssue    = require('../../models/testing/issueModel');
const VcTemplate = require('../../models/web/vcTemplate');
const SignedVC   = require('../../models/web/signedVcModel');

// New models you provided
const StudentData = require('../../models/testing/studentDataModel');
const Grade       = require('../../models/testing/gradeModel');

// Optional Curriculum model: tolerate missing file in dev/test
let Curriculum = null;
try { Curriculum = require('../../models/students/Curriculum'); } catch (_) { Curriculum = null; }

const { buildDataFromTemplate, validateAgainstTemplate } = require('../../utils/vcTemplate');
const { randomSalt, stableStringify, digestJws } = require('../../utils/vcCrypto');
const { signVcPayload } = require('../../utils/signer');

// ---------- helpers ----------

function parseExpiration(exp) {
  if (!exp || exp === 'N/A') return null;
  if (exp instanceof Date && !Number.isNaN(exp.getTime())) return exp;
  const d = new Date(exp);
  if (Number.isNaN(d.getTime())) {
    const e = new Error('Invalid expiration format'); e.status = 400; throw e;
  }
  return d;
}

// Normalize to 'tor' | 'diploma' from request or template.vc.type
function inferKind(typeParam, templateVc) {
  const t = String(typeParam || '').toLowerCase();
  if (t.includes('tor')) return 'tor';
  if (t.includes('diploma')) return 'diploma';

  const arr = Array.isArray(templateVc?.type) ? templateVc.type.map(s => String(s).toLowerCase()) : [];
  if (arr.some(s => s.includes('tor'))) return 'tor';
  if (arr.some(s => s.includes('diploma'))) return 'diploma';
  return 'diploma';
}

// "Lastname, Firstname M." (simple deterministic formatter)
function toFullName(s) {
  if (!s) return '';
  const mid = (s.middleName || '').trim();
  const ext = (s.extName || '').trim();
  const middle = mid ? ` ${mid[0].toUpperCase()}.` : '';
  const extStr = ext ? ` ${ext}` : '';
  return `${(s.lastName || '').trim().toUpperCase()}, ${(s.firstName || '').trim().toUpperCase()}${middle}${extStr}`;
}

// sort helpers for TOR (strings in DB like "1St Year" / "Mid Year Term")
const YEAR_ORDER = ['1ST YEAR','2ND YEAR','3RD YEAR','4TH YEAR','5TH YEAR','6TH YEAR'];
const SEM_ORDER  = ['1ST SEMESTER','2ND SEMESTER','MID YEAR TERM','MID-YEAR','SUMMER','MID YEAR'];

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
const idx = (v, arr) => {
  const i = arr.indexOf(norm(v));
  return i < 0 ? 99 : i;
};

// Map Grade docs → template-friendly subjects array
function torSubjectsFromGrades(grades) {
  const sorted = [...grades].sort((a, b) =>
    idx(a.yearLevel, YEAR_ORDER) - idx(b.yearLevel, YEAR_ORDER) ||
    idx(a.semester,  SEM_ORDER)  - idx(b.semester,  SEM_ORDER)  ||
    String(a.subjectCode || '').localeCompare(String(b.subjectCode || ''))
  );

  return sorted.map(g => ({
    subjectCode:  g.subjectCode,
    subjectTitle: g.subjectTitle || '',
    units:        Number.isFinite(Number(g.units)) ? Number(g.units) : null,
    finalGrade:   g.finalGrade,
    remarks:      g.remarks,
    yearLevel:    g.yearLevel,
    semester:     g.semester,
    schoolYear:   g.schoolYear || null,
    termName:     g.termName   || null,
  }));
}

// Centralized loader for Student_Data (+ Curriculum + Grades for TOR)
async function loadStudentAndContext({ studentId, studentNumber, needGrades }) {
  let studentDoc = null;

  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      const e = new Error('Invalid studentId'); e.status = 400; throw e;
    }
    studentDoc = await StudentData.findById(studentId).lean();
  } else if (studentNumber) {
    studentDoc = await StudentData.findOne({ studentNumber: String(studentNumber).trim() }).lean();
  }

  if (!studentDoc) {
    const e = new Error('Student not found'); e.status = 404; throw e;
  }

  // Enrich with computed fullName so templates that use path "fullName" still work
  const student = { ...studentDoc, fullName: toFullName(studentDoc) };

  // Curriculum (optional)
  let curriculumDoc = null;
  if (student.curriculum && Curriculum) {
    try {
      curriculumDoc = await Curriculum.findById(student.curriculum).lean();
    } catch (_) { /* ignore */ }
  }

  // Grades only if TOR
  let grades = [];
  if (needGrades) {
    grades = await Grade.find({
      student: student._id,
      ...(student.curriculum ? { curriculum: student.curriculum } : {})
    }).lean();
  }

  return { student, curriculumDoc, grades };
}

// Build the data block (credentialSubject) from template + student (+grades)
function buildSubjectData({ template, student, curriculumDoc, kind, overrides = {}, grades = [] }) {
  const effectiveOverrides = { ...(overrides || {}) };

  if (kind === 'tor') {
    // Populate subjects + gwa (if present on Student_Data)
    effectiveOverrides.subjects = Array.isArray(effectiveOverrides.subjects) && effectiveOverrides.subjects.length
      ? effectiveOverrides.subjects
      : torSubjectsFromGrades(grades);

    if (student.collegeGwa != null && effectiveOverrides.gwa == null) {
      effectiveOverrides.gwa = student.collegeGwa;
    }
  }

  // IMPORTANT: We no longer fall back to templateDefaults — template.attributes must be present.
  const attrs = Array.isArray(template.attributes) ? template.attributes : [];
  if (!attrs.length) {
    const e = new Error('Template has no attributes configured'); e.status = 400; throw e;
  }

  const withAttrs = { ...template.toObject(), attributes: attrs };

  const data = buildDataFromTemplate(withAttrs, student, effectiveOverrides, curriculumDoc);
  const { valid, errors } = validateAgainstTemplate(withAttrs, data);
  if (!valid) {
    const e = new Error('Validation failed: ' + errors.join('; ')); e.status = 400; throw e;
  }
  return data;
}

// Create a VC payload (before signing)
function makeVcPayload({ kind, issuerDid, purpose, expiration, subjectData }) {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', kind],
    issuer: { id: issuerDid },
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      ...subjectData,
      purpose: purpose || null,
      expires: expiration || null,
    },
  };
}

// ---------- core: create one issue ----------
async function createOneIssue({
  studentId, studentNumber, templateId, type, purpose,
  expiration, overrides, amount, anchorNow,
}) {
  if (!templateId || !purpose) {
    const e = new Error('Missing templateId or purpose'); e.status = 400; throw e;
  }
  if (!mongoose.isValidObjectId(templateId)) {
    const e = new Error('Invalid templateId'); e.status = 400; throw e;
  }

  const template = await VcTemplate.findById(templateId);
  if (!template) { const e = new Error('Template not found'); e.status = 404; throw e; }

  const kind = inferKind(type, template.vc); // 'tor' | 'diploma'
  const { student, curriculumDoc, grades } = await loadStudentAndContext({
    studentId, studentNumber, needGrades: kind === 'tor'
  });

  // Prevent duplicate open issue per (student, template, purpose)
  const dup = await VcIssue.findOne({
    student: student._id, template: template._id, purpose, status: 'issued'
  }).lean();
  if (dup) return { status: 'duplicate', issue: dup };

  const data = buildSubjectData({
    template, student, curriculumDoc, kind, overrides, grades,
  });

  const price = Number.isFinite(Number(template.price)) ? Number(template.price) : 250;

  let issue = await VcIssue.create({
    template: template._id,
    student:  student._id,
    type:     kind,
    purpose,
    data,
    expiration: parseExpiration(expiration),
    amount: amount != null ? Number(amount) : price,
    currency: 'PHP',
    anchorNow: !!anchorNow,
    status: 'issued',
  });

  // Populate minimal fields for response
  issue = await issue
    .populate({ path: 'student',  model: StudentData, select: 'studentNumber program dateGraduated firstName lastName middleName extName' })
    .populate({ path: 'template', select: 'name slug version price' });

  return { status: 'created', issue };
}

// ---------- HTTP handlers ----------

// 1) Create issue (single or batch)
exports.createIssue = asyncHandler(async (req, res) => {
  const body = req.body;

  // Batch mode
  if (Array.isArray(body)) {
    const results = [];
    for (const item of body) {
      try {
        const r = await createOneIssue(item);
        results.push(r);
      } catch (e) {
        results.push({ status: 'error', error: e.message, input: item });
      }
    }

    const created = results.filter(r => r.status === 'created').map(r => r.issue);
    const duplicates = results.filter(r => r.status === 'duplicate').map(r => r.issue);
    const errors = results.filter(r => r.status === 'error');

    return res.status(created.length ? 201 : 200).json({
      createdCount: created.length,
      duplicateCount: duplicates.length,
      errorCount: errors.length,
      created, duplicates, errors,
    });
  }

  // Single
  const result = await createOneIssue(body);
  if (result.status === 'duplicate') {
    return res.status(409).json({ message: 'Open issue already exists', issue: result.issue });
  }
  res.status(201).json(result.issue);
});

// 2) List issues
exports.listIssues = asyncHandler(async (req, res) => {
  const { type, range, program, q, template, status, orderNo, receiptNo, unpaidOnly } = req.query;
  const filter = {};

  if (type && type !== 'All') filter.type = String(type).toLowerCase();
  if (template && mongoose.isValidObjectId(template)) filter.template = template;

  const hasStatus = Object.prototype.hasOwnProperty.call(req.query, 'status');
  if (hasStatus && status && status !== 'All') {
    filter.status = status; // 'issued' | 'signed' | 'anchored' | 'void'
  }

  if (orderNo)   filter.order_no = String(orderNo).trim();
  if (receiptNo) filter.receipt_no = String(receiptNo).trim().toUpperCase();

  // 👇 NEW: cashier wants only those without receipt yet
  if (String(unpaidOnly).toLowerCase() === 'true') {
    // only issues that have no receipt set
    filter.receipt_no = null;

    // and usually you only care about "issued" ones
    if (!filter.status) {
      filter.status = 'issued';
    }
  }

  // Date range on createdAt
  if (range && range !== 'All') {
    let start = null;
    if (range === 'today') { start = new Date(); start.setHours(0,0,0,0); }
    if (range === '1w')    { start = new Date(Date.now() - 7  * 864e5); }
    if (range === '1m')    { start = new Date(Date.now() - 30 * 864e5); }
    if (range === '6m')    { start = new Date(Date.now() - 182* 864e5); }
    if (start) filter.createdAt = { $gte: start };
  }

  let rows = await VcIssue.find(filter)
    .populate({
      path: 'student',
      model: StudentData,
      select: 'studentNumber program dateGraduated firstName lastName middleName extName',
      ...(program && program !== 'All' ? { match: { program } } : {}),
    })
    .populate({ path: 'template', select: 'name slug version price' })
    .sort({ createdAt: -1 });

  if (program && program !== 'All') {
    rows = rows.filter(r => r.student);
  }

  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(r => {
      const s = r.student || {};
      const fullName = toFullName(s);
      return (
        fullName.toLowerCase().includes(needle) ||
        String(s.studentNumber || '').toLowerCase().includes(needle) ||
        String(r.type || '').toLowerCase().includes(needle) ||
        String(r.purpose || '').toLowerCase().includes(needle) ||
        String(r.order_no || '').toLowerCase().includes(needle) ||
        String(r.receipt_no || '').toLowerCase().includes(needle) ||
        String(r.template?.name || '').toLowerCase().includes(needle)
      );
    });
  }

  res.json(rows);
});


// 3) Delete issue (allowed only while "issued" and not paid)
exports.deleteIssue = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid id'); }

  const issue = await VcIssue.findById(id).select('_id status receipt_no').lean();
  if (!issue) { res.status(404); throw new Error('Issue not found'); }
  if (issue.status !== 'issued') {
    res.status(409); throw new Error('Cannot delete: issue already signed/anchored/void');
  }
  if (issue.receipt_no) {
    res.status(409); throw new Error('Cannot delete: already has a receipt number (paid)');
  }

  await VcIssue.deleteOne({ _id: id, status: 'issued', receipt_no: null });
  res.json({ _id: id, deleted: true, message: 'Issue deleted' });
});

// 4) Preview the VC payload that will be signed (no JWS yet)
exports.preview = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid id'); }

  const issue = await VcIssue.findById(id).populate({
    path: 'student', model: StudentData, select: 'studentNumber program dateGraduated firstName lastName middleName extName'
  });
  if (!issue) { res.status(404); throw new Error('Issue not found'); }

  const issuerDid = process.env.ISSUER_DID || 'did:web:example.org';
  const vcPayload = makeVcPayload({
    kind: issue.type,
    issuerDid,
    purpose: issue.purpose,
    expiration: issue.expiration,
    subjectData: {
      // Ensure these common fields are present (template normally covers them but make it robust)
      studentNumber: issue.student?.studentNumber,
      fullName:      toFullName(issue.student),
      program:       issue.student?.program,
      dateGraduated: issue.student?.dateGraduated,
      ...issue.data,
    },
  });

  res.json(vcPayload);
});

// 5) Cashier payment → sign now (by issue id)
exports.payAndSign = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid id'); }

  const { receipt_no, receipt_date, amount, anchorNow } = req.body || {};
  if (!receipt_no) { res.status(400); throw new Error('receipt_no is required'); }

  const issue = await VcIssue.findById(id)
    .populate({ path: 'student',  model: StudentData, select: 'studentNumber program dateGraduated firstName lastName middleName extName' })
    .populate({ path: 'template', select: 'name slug version price vc' });

  if (!issue) { res.status(404); throw new Error('Issue not found'); }

  if (issue.status === 'signed' && issue.signedVc) {
    // idempotent: already signed
    return res.json({ message: 'Already signed', credential_id: issue.signedVc, order_no: issue.order_no });
  }
  if (issue.status !== 'issued') {
    res.status(409); throw new Error('Issue is not in "issued" status');
  }

  // ---- Step 1: record cashier inputs on the Issue ----
  if (amount && Number(amount) > 0) issue.amount = Number(amount);
  issue.receipt_no   = String(receipt_no).trim().toUpperCase();
  issue.receipt_date = receipt_date ? new Date(receipt_date) : new Date();
  if (typeof anchorNow === 'boolean') issue.anchorNow = !!anchorNow;

  // Receipt uniqueness guard
  try {
    await issue.save();
  } catch (e) {
    if (e?.code === 11000 && e?.keyPattern?.receipt_no) {
      res.status(409); throw new Error('Receipt number already used');
    }
    throw e;
  }

  // ---- Step 2: build VC payload from stored snapshot + common fields ----
  const issuerDid = process.env.ISSUER_DID || 'did:web:example.org';
  const vcPayload = makeVcPayload({
    kind: issue.type,
    issuerDid,
    purpose: issue.purpose,
    expiration: issue.expiration,
    subjectData: {
      studentNumber: issue.student?.studentNumber,
      fullName:      toFullName(issue.student),
      program:       issue.student?.program,
      dateGraduated: issue.student?.dateGraduated,
      ...issue.data,
    },
  });

  // ---- Step 3: sign JWS (ES256) ----
  const jws = await signVcPayload(vcPayload); // uses utils/signer (dynamic import of jose)
  const salt = randomSalt();
  const digest = digestJws(jws, salt);

  // ---- Step 4: persist SignedVC ----
  const kid = process.env.ISSUER_KID || 'did:web:example.org#keys-1';
  const signed = await SignedVC.create({
    student_id:  issue.student?.studentNumber,
    holder_user_id: null,
    template_id: issue.type,
    format:      'jws-vc',
    jws, alg: 'ES256', kid,
    vc_payload:  JSON.parse(stableStringify(vcPayload)),
    digest, salt,
    status: 'active',
    anchoring: { state: 'unanchored', queue_mode: 'none' },
  });

  // ---- Step 5: flip Issue → signed ----
  issue.status   = 'signed';
  issue.signedAt = new Date();
  issue.signedVc = signed._id;
  await issue.save();

  // ---- Step 6: optional queue for anchoring NOW ----
  const wantAnchor = issue.anchorNow === true;
  if (wantAnchor) {
    // We can reuse your existing anchor controller
    const anchorCtrl = require('./anchorController');
    req.params.credId = signed._id.toString();
    return anchorCtrl.requestNow(req, res); // responds with {message, credential_id}
  }

  res.status(201).json({
    message: 'Signed',
    credential_id: signed._id,
    key: signed.key,
    order_no: issue.order_no,
    status: signed.status,
    anchoring: signed.anchoring,
  });
});

// 6) Cashier payment → sign now (by order number)
exports.payAndSignByOrderNo = asyncHandler(async (req, res) => {
  const orderNo = String(req.params.orderNo || '').trim();
  if (!orderNo) { res.status(400); throw new Error('orderNo is required'); }
  const issue = await VcIssue.findOne({ order_no: orderNo });
  if (!issue) { res.status(404); throw new Error('Issue not found'); }
  req.params.id = issue._id.toString();
  return exports.payAndSign(req, res);
});
