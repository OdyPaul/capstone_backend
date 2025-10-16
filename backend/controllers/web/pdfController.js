// controllers/web/pdfController.js
const asyncHandler = require('express-async-handler');
const hbs = require('handlebars');
const fs = require('fs/promises');
const path = require('path');
// ❌ do not import plain puppeteer on Render
// const puppeteer = require('puppeteer');
const Student = require('../../models/students/studentModel');
const VerificationSession = require('../../models/web/verificationSessionModel');
const launchBrowser = require('../../utils/launchBrowser');

// Helpers ------------------------------------------------------
function toISODate(d) { return d ? new Date(d).toISOString().split('T')[0] : ''; }
function readAsDataUrl(absPath) {
  return fs.readFile(absPath)
    .then(buf => `data:image/png;base64,${buf.toString('base64')}`)
    .catch(() => null);
}
// map "1st Year" -> 1, "2nd Year" -> 2, etc.
function parseYearLevel(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
// map "1st Sem" -> 1, "2nd Sem" -> 2, "Midyear" -> 3 (optional)
function parseSemester(s) {
  const v = String(s || '').toLowerCase();
  if (v.includes('1st')) return 1;
  if (v.includes('2nd')) return 2;
  if (v.includes('mid')) return 3;
  return 9; // unknown -> last
}
function termLabel(row) {
  return `${row.semester || ''}`;
}
// paginate rows into pages
function paginateRows(rows, perFirst=24, perNext=32) {
  const pages = [];
  if (rows.length === 0) return pages;
  pages.push(rows.slice(0, perFirst));
  let i = perFirst;
  while (i < rows.length) {
    pages.push(rows.slice(i, i + perNext));
    i += perNext;
  }
  return pages;
}
function academicYearFor(yearLevelStr, admissionDate) {
  if (!admissionDate) return '';
  const base = new Date(admissionDate).getFullYear();     // e.g., 2021
  const lvl = parseYearLevel(yearLevelStr) || 1;          // "1st Year" -> 1
  const y1 = base + (lvl - 1);
  const y2 = y1 + 1;
  return `${y1}-${y2}`;                                   // "2021-2022"
}
// build rows from student.subjects, show term once with AY line
function buildRows(subjects = [], admissionDate = null) {
  const norm = subjects.map(s => ({
    yearLevel: s.yearLevel,
    semester: s.semester,
    subjectCode: s.subjectCode || '',
    subjectDescription: s.subjectDescription || '',
    finalGrade: (s.finalGrade ?? '').toString(),
    reExam: '',
    units: (s.units ?? '').toString()
  }));

  // sort by year then sem then code
  norm.sort((a, b) => {
    const ya = parseYearLevel(a.yearLevel), yb = parseYearLevel(b.yearLevel);
    if (ya !== yb) return ya - yb;
    const sa = parseSemester(a.semester), sb = parseSemester(b.semester);
    if (sa !== sb) return sa - sb;
    return (a.subjectCode || '').localeCompare(b.subjectCode || '');
  });

  // only show the term on the first row of each (year+semester) group
  // and add the academic year line beneath it.
  let lastKey = '';
  for (const r of norm) {
    const key = `${parseYearLevel(r.yearLevel)}|${parseSemester(r.semester)}`;
    if (key !== lastKey) {
      const semText = r.semester || '';
      const ay = academicYearFor(r.yearLevel, admissionDate); // 2021-2022, 2022-2023, ...
      r.termHtml = `<div>${semText}</div><div class="ay">${ay}</div>`;
      lastKey = key;
    } else {
      r.termHtml = ''; // blank for repeated rows in the same sem
    }
  }
  return norm;
}

exports.renderTorPdf = asyncHandler(async (req, res) => {
  // 1) Load student
  const student = await Student.findById(req.params.studentId).lean();
  if (!student) { res.status(404); throw new Error('Student not found'); }

  // 2) Verification session (short-lived)
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

  // 3) Build & paginate table rows
    const rows = buildRows(student.subjects || [], student.dateAdmission);
    const pageChunks = paginateRows(rows, 24, 32);

  // 4) Read background images as data URLs
  const bg1Path = path.join(__dirname, '../../templates/assets/tor-page-1.png');
  const bg2Path = path.join(__dirname, '../../templates/assets/tor-page-2.png');
  const bg1 = await readAsDataUrl(bg1Path);
  const bg2 = await readAsDataUrl(bg2Path);

  // 5) Build pages payload with bg selection
  const pages = pageChunks.map((rowsChunk, idx, arr) => ({
    rows: rowsChunk,
    continues: idx < arr.length - 1,
    bg: idx === 0 ? (bg1 || '') : (bg2 || bg1 || '')
  }));

  // 6) Compile Handlebars template
  const templatePath = path.join(__dirname, '../../templates/tor.hbs');
  const source = await fs.readFile(templatePath, 'utf8');
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
    dateOfBirth: '', // add if you store it elsewhere
    dateGraduated: toISODate(student.dateGraduated),
    gwa: student.gwa,
    verifyUrl,
    pages
  });

  // 7) Render via Puppeteer (safer settings for Render)
  const browser = await launchBrowser();
  const page = await browser.newPage();

  // Logs to Render dashboard
  page.on('console', msg => console.log('[puppeteer]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[puppeteer pageerror]', err));
  page.on('requestfailed', req => console.log('[puppeteer requestfailed]', req.url(), req.failure()?.errorText));

  // Block any external requests so we never wait on the network
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.startsWith('http://') || url.startsWith('https://')) return req.abort();
    return req.continue();
  });

  // More generous timeouts
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);

  // Do not wait for network idle (can hang on server)
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
