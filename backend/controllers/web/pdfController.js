// controllers/web/pdfController.js
const asyncHandler = require('express-async-handler');
const hbs = require('handlebars');
const fs = require('fs/promises');
const path = require('path');
// const puppeteer = require('puppeteer'); // not used on Render
const Student = require('../../models/students/studentModel');
const VerificationSession = require('../../models/web/verificationSessionModel');
const launchBrowser = require('../../utils/launchBrowser');

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

// Normalize, sort, and attach inline term label
function buildRows(subjects = [], admissionDate = null) {
  const norm = subjects.map(s => {
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
      termInline: sem ? (ay ? `${sem} (${ay})` : sem) : ''
    };
  });

  norm.sort((a, b) => {
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

// ------------------------------- Controller -----------------------------
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

  const rows = buildRows(student.subjects || [], student.dateAdmission);
  const pageChunks = paginateRows(rows, 23, 31); // tweak per your form

  const bg1 = await readAsDataUrl(path.join(__dirname, '../../templates/assets/tor-page-1.png'));
  const bg2 = await readAsDataUrl(path.join(__dirname, '../../templates/assets/tor-page-2.png'));

  const pages = pageChunks.map((rowsChunk, idx, arr) => ({
    rows: rowsChunk,
    continues: idx < arr.length - 1,
    bg: idx === 0 ? (bg1 || '') : (bg2 || bg1 || '')
  }));

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
    dateOfBirth: '', // set if available
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
