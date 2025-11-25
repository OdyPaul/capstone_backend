// controllers/issueController.js

const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const VcIssue = require('../../models/testing/issueModel');
const StudentData = require('../../models/testing/studentDataModel');

const {
  createOneIssue,
  createBatchIssue,
} = require('../../services/issueService');
const { makeVcPayload, signAndPersistVc } = require('../../services/vcService');
const { toFullName } = require('../../services/gradeService');

// -------- Create Issue (single / legacy / batch + optional seed) --------
exports.createIssue = asyncHandler(async (req, res) => {
  const body = req.body;

  // NEW MODE:
  // body = {
  //   templateId, type, purpose, expiration, anchorNow/anchor,
  //   recipients: [...],
  //   studentDataRows: [...],
  //   gradeRows: [...],
  //   seedDb: true/false
  // }
  if (!Array.isArray(body) && Array.isArray(body.recipients)) {
    const { templateId, purpose } = body;
    if (!templateId || !purpose) {
      throw Object.assign(new Error('Missing templateId or purpose'), {
        status: 400,
      });
    }

    const results = await createBatchIssue(body);

    const created = results
      .filter(r => r.status === 'created')
      .map(r => r.issue);
    const duplicates = results
      .filter(r => r.status === 'duplicate')
      .map(r => r.issue);
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

  // LEGACY: body is already an ARRAY of items (no seeding)
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

    const created = results
      .filter(r => r.status === 'created')
      .map(r => r.issue);
    const duplicates = results
      .filter(r => r.status === 'duplicate')
      .map(r => r.issue);
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

  // LEGACY: single item body (no seeding)
  const result = await createOneIssue(body);
  if (result.status === 'duplicate') {
    return res
      .status(409)
      .json({ message: 'Open issue already exists', issue: result.issue });
  }
  res.status(201).json(result.issue);
});

// -------- Preview VC payload (before signing) --------
exports.preview = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) {
    throw Object.assign(new Error('Invalid id'), { status: 400 });
  }

  const issue = await VcIssue.findById(id).populate({
    path: 'student',
    model: StudentData,
    select:
      'studentNumber program dateGraduated dateOfBirth firstName lastName middleName extName',
  });


  if (!issue) {
    throw Object.assign(new Error('Issue not found'), { status: 404 });
  }

  const issuerDid = process.env.ISSUER_DID || 'did:web:example.org';
  const vcPayload = makeVcPayload({
    kind: issue.type,
    issuerDid,
    purpose: issue.purpose,
    expiration: issue.expiration,
    subjectData: {
      studentNumber: issue.student?.studentNumber,
      fullName: toFullName(issue.student),
      program: issue.student?.program,
      dateGraduated: issue.student?.dateGraduated,
      dateOfBirth: issue.student?.dateOfBirth,
      ...issue.data,
    },
  });


  res.json(vcPayload);
});

// -------- Pay & sign by issue id --------
exports.payAndSign = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) {
    throw Object.assign(new Error('Invalid id'), { status: 400 });
  }

  const { receipt_no, receipt_date, amount, anchorNow } = req.body || {};
  if (!receipt_no) {
    throw Object.assign(new Error('receipt_no is required'), { status: 400 });
  }

  const issue = await VcIssue.findById(id)
    .populate({
      path: 'student',
      model: StudentData,
      select:
        'studentNumber program dateGraduated dateOfBirth firstName lastName middleName extName',
    })
    .populate({ path: 'template', select: 'name slug version price vc' });


  if (!issue) {
    throw Object.assign(new Error('Issue not found'), { status: 404 });
  }

  // Idempotent: already signed
  if (issue.status === 'signed' && issue.signedVc) {
    return res.json({
      message: 'Already signed',
      credential_id: issue.signedVc,
      order_no: issue.order_no,
    });
  }

  if (issue.status !== 'issued') {
    throw Object.assign(
      new Error('Issue is not in "issued" status'),
      { status: 409 },
    );
  }

  // ---- Step 1: record cashier inputs on the Issue ----
  if (amount && Number(amount) > 0) {
    issue.amount = Number(amount);
  }
  issue.receipt_no = String(receipt_no).trim().toUpperCase();
  issue.receipt_date = receipt_date ? new Date(receipt_date) : new Date();
  if (typeof anchorNow === 'boolean') {
    issue.anchorNow = !!anchorNow;
  }

  // Receipt uniqueness guard
  try {
    await issue.save();
  } catch (e) {
    if (e?.code === 11000 && e?.keyPattern?.receipt_no) {
      throw Object.assign(
        new Error('Receipt number already used'),
        { status: 409 },
      );
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
      fullName: toFullName(issue.student),
      program: issue.student?.program,
      dateGraduated: issue.student?.dateGraduated,
      dateOfBirth: issue.student?.dateOfBirth,
      ...issue.data,
    },
  });


  // ---- Step 3–5: sign JWS & persist SignedVC and flip Issue → signed ----
  const signed = await signAndPersistVc({ issue, vcPayload });

  // ---- Step 6: optional queue for anchoring NOW ----
  const wantAnchor = issue.anchorNow === true;
  if (wantAnchor) {
    const anchorCtrl = require('./anchorController');
    req.params.credId = signed._id.toString();
    return anchorCtrl.requestNow(req, res);
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

// -------- Pay & sign by order number --------
exports.payAndSignByOrderNo = asyncHandler(async (req, res) => {
  const orderNo = String(req.params.orderNo || '').trim();
  if (!orderNo) {
    throw Object.assign(new Error('orderNo is required'), { status: 400 });
  }

  const issue = await VcIssue.findOne({ order_no: orderNo });
  if (!issue) {
    throw Object.assign(new Error('Issue not found'), { status: 404 });
  }

  req.params.id = issue._id.toString();
  return exports.payAndSign(req, res);
});

// -------- List Issues --------
exports.listIssues = asyncHandler(async (req, res) => {
  const {
    type,
    range,
    program,
    q,
    template,
    status,
    orderNo,
    receiptNo,
    unpaidOnly,
  } = req.query;

  const filter = {};

  if (type && type !== 'All') {
    filter.type = String(type).toLowerCase();
  }

  if (template && mongoose.isValidObjectId(template)) {
    filter.template = template;
  }

  const hasStatus = Object.prototype.hasOwnProperty.call(req.query, 'status');
  if (hasStatus && status && status !== 'All') {
    filter.status = status; // 'issued' | 'signed' | 'anchored' | 'void'
  }

  if (orderNo) {
    filter.order_no = String(orderNo).trim();
  }

  if (receiptNo) {
    filter.receipt_no = String(receiptNo).trim().toUpperCase();
  }

  // cashier wants only those without receipt yet
  if (String(unpaidOnly).toLowerCase() === 'true') {
    filter.receipt_no = null;
    if (!filter.status) filter.status = 'issued';
  }

  // Date range on createdAt
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
      start = new Date(Date.now() - 30 * 864e5);
    }
    if (range === '6m') {
      start = new Date(Date.now() - 182 * 864e5);
    }
    if (start) {
      filter.createdAt = { $gte: start };
    }
  }

  let rows = await VcIssue.find(filter)
    .populate({
      path: 'student',
      model: StudentData,
      select:
        'studentNumber program dateGraduated firstName lastName middleName extName',
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

// -------- Delete Issue --------
exports.deleteIssue = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) {
    throw Object.assign(new Error('Invalid id'), { status: 400 });
  }

  const issue = await VcIssue.findById(id)
    .select('_id status receipt_no')
    .lean();

  if (!issue) {
    throw Object.assign(new Error('Issue not found'), { status: 404 });
  }

  if (issue.status !== 'issued') {
    throw Object.assign(
      new Error('Cannot delete: issue already signed/anchored/void'),
      { status: 409 },
    );
  }

  if (issue.receipt_no) {
    throw Object.assign(
      new Error('Cannot delete: already has a receipt number (paid)'),
      { status: 409 },
    );
  }

  await VcIssue.deleteOne({ _id: id, status: 'issued', receipt_no: null });
  res.json({ _id: id, deleted: true, message: 'Issue deleted' });
});
