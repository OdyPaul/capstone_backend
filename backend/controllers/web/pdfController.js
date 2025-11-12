const asyncHandler = require('express-async-handler');
const hbs = require('handlebars');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto'); // ← needed by hmacSig
// const puppeteer = require('puppeteer'); // not used on Render
const Student = require('../../models/students/studentModel');
const VerificationSession = require('../../models/web/verificationSessionModel');
const launchBrowser = require('../../utils/launchBrowser');

//works but not yet arrange -- 17/10/2025

// ------------------------------- Helpers --------------------------------
function toISODate(d) { return d ? new Date(d).toISOString().split('T')[0] : ''; }

async function readAsDataUrl(absPath) {
  try {
    const buf = await fs.readFile(absPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// "1st Year" -> 1, "2nd Year" -> 2
function parseYearLevel(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// "1st Sem" -> 1, "2nd Sem" -> 2, "Midyear" -> 3
function parseSemester(s) {
  const v = String(s || '').toLowerCase();
  if (v.includes('1st')) return 1;
  if (v.includes('2nd')) return 2;
  if (v.includes('mid')) return 3;
  return 9; // unknown -> last
}

// Build AY string from admission year + year level
function academicYearFor(yearLevelStr, admissionDate) {
  if (!admissionDate) return '';
  const base = new Date(admissionDate).getFullYear();
  const lvl = parseYearLevel(yearLevelStr) || 1;
  const y1 = base + (lvl - 1);
  const y2 = y1 + 1;
  return `${y1}-${y2}`;
}

function hmacSig(secret, msg) {
  return crypto.createHmac('sha256', secret).update(msg).digest('base64url');
}
function buildSignedTorFromSessionUrl({ base, sessionId, ttlMin = 15 }) {
  const exp = Date.now() + Math.max(1, Number(ttlMin)) * 60 * 1000;
  const secret = process.env.PRINT_SIGNING_SECRET || '';
  const sig = hmacSig(secret, `${sessionId}:${exp}`);
  const origin = String(base || '').replace(/\/+$/, '');
  return `${origin}/api/web/tor/from-session/pdf-signed?session=${encodeURIComponent(sessionId)}&exp=${exp}&sig=${sig}`;
}

// Normalize, sort, and attach inline term label
function buildRows(subjects = [], admissionDate = null) {
  const norm = (subjects || []).map(s => {
    const ay = academicYearFor(s.yearLevel, admissionDate);
    const sem = s.semester || '';
    return {
      yearLevel: s.yearLevel,
      semester: sem,
      subjectCode: s.subjectCode || '',
      subjectDescription: s.subjectDescription || '',
      finalGrade: (s.finalGrade ?? '').toString(),
      reExam: '',
      units: (s.units ?? '').toString(),
      ay,
      termInline: sem ? (ay ? `${sem} (${ay})` : sem) : '',
      termKey: `${parseYearLevel(s.yearLevel)||0}|${parseSemester(sem)}`,
      _termLabelHtml: `<div>${sem}</div><div class="ay">${ay || ''}</div>`
    };
  });

  norm.sort((a,b) => {
    const ya = parseYearLevel(a.yearLevel), yb = parseYearLevel(b.yearLevel);
    if (ya !== yb) return ya - yb;
    const sa = parseSemester(a.semester), sb = parseSemester(b.semester);
    if (sa !== sb) return sa - sb;
    return (a.subjectCode || '').localeCompare(b.subjectCode || '');
  });

  return norm;
}

// Simple pagination
function paginateRows(rows, perFirst = 24, perNext = 32) {
  const pages = [];
  if (!rows.length) return pages;
  pages.push(rows.slice(0, perFirst));
  for (let i = perFirst; i < rows.length; i += perNext) {
    pages.push(rows.slice(i, i + perNext));
  }
  return pages;
}

// ------------------------------- Controllers -----------------------------

// Admin/staff-side: render by Student DB id (unchanged)
exports.renderTorPdf = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.studentId).lean();
  if (!student) { res.status(404); throw new Error('Student not found'); }

  // (Optional) short-lived verification session used for verifyUrl in the PDF
  const sessionId = 'prs_' + Math.random().toString(36).slice(2,10);
  const expires_at = new Date(Date.now() + 48*3600*1000);
  await VerificationSession.create({
    session_id: sessionId,
    employer: { org: 'PDF-Viewer', contact: '' },
    request: { types: ['TOR'], purpose: 'Print' },
    result: { valid: false, reason: 'pending' },
    expires_at
  });
  const verifyUrl = `${process.env.BASE_URL}/verify/${sessionId}`;

  // 1) normalize + paginate
  const baseRows  = buildRows(student.subjects || [], student.dateAdmission);
  const pageChunks = paginateRows(baseRows, 23, 31);

  // 2) build pages (SEM/AY label only on first row of each term per page)
  const pages = pageChunks.map(chunk => {
    let prevKey = null;
    const rows = chunk.map(r => {
      const termHtml = (r.termKey !== prevKey) ? r._termLabelHtml : '';
      prevKey = r.termKey;
      return { ...r, termHtml };
    });
    return { rows, continues: false, bg: '' }; // bg gets filled in step 3
  });

  // 3) load backgrounds, then assign per page
  const bg1 = await readAsDataUrl(path.join(__dirname, '../../templates/assets/tor-page-1.png'));
  const bg2 = await readAsDataUrl(path.join(__dirname, '../../templates/assets/tor-page-2.png'));

  pages.forEach((p, i, arr) => {
    p.bg = i === 0 ? (bg1 || '') : (bg2 || bg1 || '');
    p.continues = i < arr.length - 1;
  });

  // 4) compile and render the Handlebars template
  const source = await fs.readFile(path.join(__dirname, '../../templates/tor.hbs'), 'utf8');
  const tpl = hbs.compile(source);

  const html = tpl({
    issuerName: process.env.ISSUER_NAME || 'University Registrar',
    fullName: student.fullName,
    studentNumber: student.studentNumber,
    address: student.address || '',
    entranceCredentials: student.entranceCredentials || '',
    highSchool: student.highSchool || '',
    program: student.program || '',
    major: student.major || '',
    placeOfBirth: student.placeOfBirth || '',
    dateAdmission: toISODate(student.dateAdmission),
    dateOfBirth: '', // if you have it
    dateGraduated: toISODate(student.dateGraduated),
    dateIssued: toISODate(new Date()),
    gwa: student.gwa,
    verifyUrl,
    pages
  });

  const browser = await launchBrowser();
  const page = await browser.newPage();

  // Avoid hanging on external requests
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://') || u.startsWith('https://')) return req.abort();
    return req.continue();
  });

  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);

  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.emulateMediaType('screen');

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    preferCSSPageSize: true,
    timeout: 0
  });

  await browser.close();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="TOR_${student.studentNumber}.pdf"`);
  res.send(pdf);
});

// Public/signed: render from VerificationSession snapshot (printable VC)
exports.renderTorPdfFromSessionSigned = asyncHandler(async (req, res) => {
  const { session, exp, sig } = req.query || {};
  if (!session || !exp || !sig) return res.status(400).json({ message: 'Missing signature params' });

  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || Date.now() > expMs) return res.status(410).json({ message: 'Link expired' });

  const secret = process.env.PRINT_SIGNING_SECRET || '';
  const expect = hmacSig(secret, `${session}:${exp}`);
  if (sig !== expect) return res.status(401).json({ message: 'Bad signature' });

  const sess = await VerificationSession.findOne({ session_id: session }).lean();
  if (!sess) return res.status(404).json({ message: 'Session not found' });
  if (!sess.result?.valid) return res.status(403).json({ message: 'Verification not completed' });

  const p = sess.result?.meta?.printable;
  if (!p) return res.status(422).json({ message: 'Printable payload not available' });

  // 1) normalize + paginate
  const baseRows  = buildRows(p.subjects || [], p.dateAdmission);
  const pageChunks = paginateRows(baseRows, 23, 31);

  // 2) term labels per page
  const pages = pageChunks.map(chunk => {
    let prevKey = null;
    const rows = chunk.map(r => {
      const termHtml = (r.termKey !== prevKey) ? r._termLabelHtml : '';
      prevKey = r.termKey;
      return { ...r, termHtml };
    });
    return { rows, continues: false, bg: '' };
  });

  // 3) page backgrounds
  const bg1 = await readAsDataUrl(path.join(__dirname, '../../templates/assets/tor-page-1.png'));
  const bg2 = await readAsDataUrl(path.join(__dirname, '../../templates/assets/tor-page-2.png'));
  pages.forEach((pg, i, arr) => {
    pg.bg = i === 0 ? (bg1 || '') : (bg2 || bg1 || '');
    pg.continues = i < arr.length - 1;
  });

  // 4) compile + render
  const source = await fs.readFile(path.join(__dirname, '../../templates/tor.hbs'), 'utf8');
  const tpl = hbs.compile(source);

  const BASE = String(process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const html = tpl({
    issuerName: process.env.ISSUER_NAME || 'University Registrar',
    fullName: p.fullName || '',
    studentNumber: p.studentNumber || '',
    address: p.address || '',
    entranceCredentials: p.entranceCredentials || '',
    highSchool: p.highSchool || '',
    program: p.program || '',
    major: p.major || '',
    placeOfBirth: p.placeOfBirth || '',
    dateAdmission: toISODate(p.dateAdmission),
    dateOfBirth: '',
    dateGraduated: toISODate(p.dateGraduated),
    dateIssued: toISODate(new Date()),
    gwa: p.gwa || '',
    verifyUrl: `${BASE}/verify/${session}`,
    pages
  });

  const browser = await launchBrowser();
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.startsWith('http://') || u.startsWith('https://')) return r.abort();
    return r.continue();
  });

  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.emulateMediaType('screen');

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    preferCSSPageSize: true,
  });

  await browser.close();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="TOR_${(p.studentNumber||'VC')}.pdf"`);
  res.send(pdf);
});

// Export URL builder for controller use
exports._buildSignedTorFromSessionUrl = buildSignedTorFromSessionUrl;
