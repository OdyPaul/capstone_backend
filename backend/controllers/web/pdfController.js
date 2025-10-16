// controllers/web/pdfController.js
const asyncHandler = require('express-async-handler');
const hbs = require('handlebars');
const fs = require('fs/promises');
const path = require('path');
const puppeteer = require('puppeteer');
const Student = require('../../models/web/studentModel');
const VerificationSession = require('../../models/web/verificationSessionModel');

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
  // What to display in the TERM column
  // You can refine this to include AY if you store it. For now:
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
// build rows from student.subjects
function buildRows(subjects=[]) {
  const norm = subjects.map(s => ({
    yearLevel: s.yearLevel,
    semester: s.semester,
    subjectCode: s.subjectCode || '',
    subjectDescription: s.subjectDescription || '',
    finalGrade: (s.finalGrade ?? '').toString(),
    reExam: '', // you can compute / fill if you track it
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
  // attach TERM labels
  norm.forEach(r => r.term = termLabel(r));
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
  const rows = buildRows(student.subjects || []);
  // tune per page counts to match your background grid
  const pageChunks = paginateRows(rows, /*perFirst*/24, /*perNext*/32);

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

  // 7) Render via Puppeteer
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  // If your form is Letter, change format: 'Letter'
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
  });
  await browser.close();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="TOR_${student.studentNumber}.pdf"`);
  res.send(pdf);
});
