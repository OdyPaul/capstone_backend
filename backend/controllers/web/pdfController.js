// backend/controllers/web/pdfController.js
const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const hbs = require("handlebars");
const fs = require("fs/promises");
const path = require("path");

const Student = require("../../models/students/studentModel");
const VerificationSession = require("../../models/web/verificationSessionModel");
const launchBrowser = require("../../utils/launchBrowser");

/* ------------------------------- Helpers ------------------------------- */
function toISODate(d) { return d ? new Date(d).toISOString().split("T")[0] : ""; }

async function readAsDataUrl(absPath) {
  try {
    const buf = await fs.readFile(absPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch { return null; }
}

// "1st Year" -> 1, "2nd Year" -> 2
function parseYearLevel(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// "1st Sem" -> 1, "2nd Sem" -> 2, "Midyear" -> 3
function parseSemester(s) {
  const v = String(s || "").toLowerCase();
  if (v.includes("1st")) return 1;
  if (v.includes("2nd")) return 2;
  if (v.includes("mid")) return 3;
  return 9; // unknown -> last
}

// Build AY string from admission year + year level
function academicYearFor(yearLevelStr, admissionDate) {
  if (!admissionDate) return "";
  const base = new Date(admissionDate).getFullYear();
  const lvl = parseYearLevel(yearLevelStr) || 1;
  const y1 = base + (lvl - 1);
  const y2 = y1 + 1;
  return `${y1}-${y2}`;
}

// Normalize + sort + attach term labels for template
function buildRows(subjects = [], admissionDate = null) {
  const norm = (subjects || []).map((s) => {
    const ay = academicYearFor(s.yearLevel, admissionDate);
    const sem = s.semester || "";
    return {
      yearLevel: s.yearLevel,
      semester: sem,
      subjectCode: s.subjectCode || "",
      subjectDescription: s.subjectDescription || "",
      finalGrade: (s.finalGrade ?? "").toString(),
      reExam: "",
      units: (s.units ?? "").toString(),
      ay,
      termInline: sem ? (ay ? `${sem} (${ay})` : sem) : "",
      termKey: `${parseYearLevel(s.yearLevel) || 0}|${parseSemester(sem)}`,
      _termLabelHtml: `<div>${sem}</div><div class="ay">${ay || ""}</div>`,
    };
  });

  norm.sort((a, b) => {
    const ya = parseYearLevel(a.yearLevel), yb = parseYearLevel(b.yearLevel);
    if (ya !== yb) return ya - yb;
    const sa = parseSemester(a.semester), sb = parseSemester(b.semester);
    if (sa !== sb) return sa - sb;
    return (a.subjectCode || "").localeCompare(b.subjectCode || "");
  });

  return norm;
}

function paginateRows(rows, perFirst = 24, perNext = 32) {
  const pages = [];
  if (!rows.length) return pages;
  pages.push(rows.slice(0, perFirst));
  for (let i = perFirst; i < rows.length; i += perNext) {
    pages.push(rows.slice(i, i + perNext));
  }
  return pages;
}

async function loadBackgrounds() {
  const bg1 = await readAsDataUrl(path.join(__dirname, "../../templates/assets/tor-page-1.png"));
  const bg2 = await readAsDataUrl(path.join(__dirname, "../../templates/assets/tor-page-2.png"));
  return { bg1, bg2 };
}

async function compileTemplate() {
  const source = await fs.readFile(path.join(__dirname, "../../templates/tor.hbs"), "utf8");
  return hbs.compile(source);
}

function rowsToPages(baseRows, _admissionDate, bg1, bg2, firstCount = 23, nextCount = 31) {
  const pageChunks = paginateRows(baseRows, firstCount, nextCount);
  return pageChunks.map((chunk, idx, arr) => {
    let prevKey = null;
    const rows = chunk.map((r) => {
      const termHtml = (r.termKey !== prevKey) ? r._termLabelHtml : "";
      prevKey = r.termKey;
      return { ...r, termHtml };
    });
    return { rows, continues: idx < arr.length - 1, bg: idx === 0 ? (bg1 || "") : (bg2 || bg1 || "") };
  });
}

function ensureAtLeastOnePage(pages, bg1, bg2) {
  if (Array.isArray(pages) && pages.length) return pages;
  return [{ rows: [], continues: false, bg: bg1 || bg2 || "" }];
}

/* --------------------------- HMAC & Signed URL -------------------------- */
function hmac(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

function _buildSignedTorFromSessionUrl({ base, sessionId, ttlMin = 15 }) {
  const PRINT_URL_SECRET = process.env.PRINT_URL_SECRET || "dev-secret-change-me";
  const exp = Date.now() + Math.max(1, Number(ttlMin)) * 60 * 1000;
  const tok = crypto.randomBytes(10).toString("base64url");
  const payload = `sid=${sessionId}&exp=${exp}&tok=${tok}`;
  const sig = hmac(payload, PRINT_URL_SECRET);
  const urlBase = `${String(base).replace(/\/+$/, "")}/api/web/pdf/tor-from-session`;
  return `${urlBase}?${payload}&sig=${sig}`;
}

/* ------------------------------ Controllers ----------------------------- */
/**
 * Admin route: render TOR from Student doc using your Handlebars template.
 * GET /api/web/tor/:studentId/pdf  (protected)
 */
const renderTorPdf = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.studentId).lean();
  if (!student) { res.status(404); throw new Error("Student not found"); }

  // Optional short-lived session -> verify URL printed on template
  const sessionId = "prs_" + Math.random().toString(36).slice(2, 10);
  const expires_at = new Date(Date.now() + 48 * 3600 * 1000);
  await VerificationSession.create({
    session_id: sessionId,
    employer: { org: "PDF-Viewer", contact: "" },
    request: { types: ["TOR"], purpose: "Print" },
    result: { valid: false, reason: "pending" },
    expires_at,
  });
  const UI_BASE = (process.env.FRONTEND_BASE_URL || process.env.UI_BASE_URL || process.env.BASE_URL || "").replace(/\/+$/,"");
  const verifyUrl = `${UI_BASE}/verify/${sessionId}`;

  const baseRows = buildRows(student.subjects || [], student.dateAdmission);
  const { bg1, bg2 } = await loadBackgrounds();
  const pages = ensureAtLeastOnePage(rowsToPages(baseRows, student.dateAdmission, bg1, bg2, 23, 31), bg1, bg2);
  const tpl = await compileTemplate();

  const html = tpl({
    issuerName: process.env.ISSUER_NAME || "University Registrar",
    fullName: student.fullName,
    studentNumber: student.studentNumber,
    address: student.address || "",
    entranceCredentials: student.entranceCredentials || "",
    highSchool: student.highSchool || "",
    program: student.program || "",
    major: student.major || "",
    placeOfBirth: student.placeOfBirth || "",
    dateAdmission: toISODate(student.dateAdmission),
    dateOfBirth: "", // if available, fill here
    dateGraduated: toISODate(student.dateGraduated),
    dateIssued: toISODate(new Date()),
    gwa: student.gwa,
    verifyUrl,
    pages,
  });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    // Avoid hanging on external requests
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const u = r.url();
      if (u.startsWith("http://") || u.startsWith("https://")) return r.abort();
      return r.continue();
    });

    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(120000);

    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.emulateMediaType("screen");
    try { await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())); } catch {}
    await page.waitForTimeout(80);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      preferCSSPageSize: true,
      timeout: 0,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="TOR_${student.studentNumber}.pdf"`);
    res.send(pdf);
  } finally {
    try { await browser.close(); } catch {}
  }
});

/**
 * Public signed route: render TOR from completed verification session,
 * using the SAME Handlebars template + PNG backgrounds.
 * GET /api/web/pdf/tor-from-session?sid=...&exp=...&tok=...&sig=...
 */
const torFromSessionSigned = asyncHandler(async (req, res) => {
  const { sid, exp, tok, sig } = req.query || {};
  const PRINT_URL_SECRET = process.env.PRINT_URL_SECRET || "dev-secret-change-me";
  if (!sid || !exp || !tok || !sig) return res.status(400).send("Missing params");

  const base = `sid=${sid}&exp=${exp}&tok=${tok}`;
  const expect = hmac(base, PRINT_URL_SECRET);
  if (sig !== expect) return res.status(403).send("Bad signature");
  if (Date.now() > Number(exp)) return res.status(410).send("Link expired");

  const sess = await VerificationSession.findOne({ session_id: sid });
  if (!sess) return res.status(404).send("Session not found");

  const used = Array.isArray(sess?.result?.meta?.print_tokens_used) ? sess.result.meta.print_tokens_used : [];
  if (used.includes(tok)) return res.status(410).send("Link already used");

  const r = sess.result || {};
  if (!r || r.reason === "pending") return res.status(409).send("Not ready");
  if (!(r.valid || r.reason === "not_anchored")) return res.status(403).send("Verification failed");

  const meta = r.meta || {};
  const printable = meta.printable || {}; // produced by verificationController.submitPresentation

  // Build rows/pages from printable payload
  const baseRows = buildRows(Array.isArray(printable.subjects) ? printable.subjects : [], printable.dateAdmission || null);
  const { bg1, bg2 } = await loadBackgrounds();
  const pages = ensureAtLeastOnePage(rowsToPages(baseRows, printable.dateAdmission || null, bg1, bg2, 23, 31), bg1, bg2);

  const UI_BASE = (process.env.FRONTEND_BASE_URL || process.env.UI_BASE_URL || process.env.BASE_URL || "").replace(/\/+$/,"");
  const verifyUrl = `${UI_BASE}/verify/${sid}`;

  const tpl = await compileTemplate();
  const html = tpl({
    issuerName: process.env.ISSUER_NAME || "University Registrar",
    fullName: printable.fullName || meta.holder_name || "-",
    studentNumber: printable.studentNumber || "-",
    address: printable.address || "",
    entranceCredentials: printable.entranceCredentials || "",
    highSchool: printable.highSchool || "",
    program: printable.program || "",
    major: printable.major || "",
    placeOfBirth: printable.placeOfBirth || "",
    dateAdmission: toISODate(printable.dateAdmission || ""),
    dateOfBirth: "", // if available in your printable, add and map
    dateGraduated: toISODate(printable.dateGraduated || ""),
    dateIssued: toISODate(new Date()),
    gwa: printable.gwa || "",
    verifyUrl,
    pages,
  });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    // Block externals; everything is inline/data:
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const u = r.url();
      if (u.startsWith("http://") || u.startsWith("https://")) return r.abort();
      return r.continue();
    });

    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMediaType("screen");
    try { await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())); } catch {}
    await page.waitForTimeout(80);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      preferCSSPageSize: true,
    });

    // mark token as used
    const nextUsed = Array.isArray(used) ? [...used, tok] : [tok];
    sess.result = {
      ...(sess.result || {}),
      meta: { ...(sess.result?.meta || {}), print_tokens_used: nextUsed, printed_at: new Date() },
    };
    sess.markModified("result");
    await sess.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } finally {
    try { await browser.close(); } catch {}
  }
});

module.exports = {
  _buildSignedTorFromSessionUrl, // used by verificationController to inject a signed print link
  torFromSessionSigned,          // public signed route
  renderTorPdf,                  // admin/manual route using Student + template
};
