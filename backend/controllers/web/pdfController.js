// backend/controllers/web/pdfController.js
const path = require('path');
const fs = require('fs/promises');

/** -------- pdfme (ESM) loader for CommonJS projects -------- */
let _generate = null;
let _schemas = null;
async function ensurePdfme() {
  if (_generate && _schemas) return { generate: _generate, schemas: _schemas };
  const gen = await import('@pdfme/generator');
  const sch = await import('@pdfme/schemas');
  _generate = gen.generate;
  _schemas = sch;
  return { generate: _generate, schemas: _schemas };
}

/** -------- Paths -------- */
const ROOT = path.join(__dirname, '../../');
const BUILD_DIR = path.join(ROOT, 'pdf_build');
const TOR_DIR = path.join(BUILD_DIR, 'tor');
const DIP_DIR = path.join(BUILD_DIR, 'diploma');
const FONTS_DIR = path.join(BUILD_DIR, 'fonts');

/** -------- Helpers -------- */
async function readJSON(p) {
  const txt = await fs.readFile(p, 'utf8');
  return JSON.parse(txt);
}
async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}
async function loadTemplate(kind) {
  const base = kind === 'tor' ? TOR_DIR : DIP_DIR;
  return readJSON(path.join(base, 'template.json'));
}
async function loadSample(kind) {
  const base = kind === 'tor' ? TOR_DIR : DIP_DIR;
  const fp = path.join(base, 'data.sample.json');
  try { return await readJSON(fp); }
  catch {
    return kind === 'tor'
      ? {
          fullName: 'Jane D. Student',
          dateAdmission: '2021-08-23',
          address: 'Magalang, Pampanga',
          placeOfBirth: 'San Fernando, Pampanga',
          entranceCredentials: 'HS Card',
          highSchool: 'Pampanga NHS',
          program: 'BS in Agriculture',
          major: 'Crop Science',
          dateGraduated: '2025-06-19',
          issuedDate: '2025-07-01',
          rows_page1: [],
          rows_page2: []
        }
      : {
          fullName: 'Jane D. Student',
          program: 'BS in Agriculture',
          major: 'Crop Science',
          dateGraduated: '2025-06-19',
          issuedDate: '2025-07-01'
        };
  }
}

async function loadFonts() {
  const regular = await fs.readFile(path.join(FONTS_DIR, 'NotoSans-Regular.ttf'));
  let bold;
  try { bold = await fs.readFile(path.join(FONTS_DIR, 'NotoSans-SemiBold.ttf')); } catch {}
  const font = { NotoSans: { data: regular, fallback: true } };
  if (bold) font.NotoSansSemiBold = { data: bold };
  return font;
}

function sendPdf(res, bytes, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(Buffer.from(bytes));
}

/** ---- Robust basePdf resolver ---- */
function isDataUrl(v) {
  return typeof v === 'string' && /^data:application\/pdf;base64,/i.test(v);
}
function toBufferFromUnknown(v) {
  if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
    return Buffer.from(v.data);
  }
  if (v && typeof v === 'object' && typeof v.byteLength === 'number') {
    return Buffer.from(new Uint8Array(v));
  }
  if (Buffer.isBuffer(v)) return v;
  return null;
}
async function resolveBasePdfBytes(kind, basePdfValue) {
  const baseDir = kind === 'tor' ? TOR_DIR : DIP_DIR;

  if (isDataUrl(basePdfValue)) {
    const idx = basePdfValue.indexOf(',');
    const b64 = idx >= 0 ? basePdfValue.slice(idx + 1) : '';
    return Buffer.from(b64, 'base64');
  }

  const fromObj = toBufferFromUnknown(basePdfValue);
  if (fromObj) return fromObj;

  if (typeof basePdfValue === 'string' && basePdfValue.trim()) {
    const p = path.isAbsolute(basePdfValue)
      ? basePdfValue
      : path.join(baseDir, basePdfValue.trim());
    return fs.readFile(p);
  }

  const fallback = path.join(baseDir, 'base.pdf');
  if (await fileExists(fallback)) return fs.readFile(fallback);

  throw new Error(
    `No base PDF found. Place "base.pdf" under ${path.relative(process.cwd(), baseDir)} or embed a data URL/path in template.basePdf.`
  );
}

/** ---- Only register plugins used by template ---- */
function buildPluginsForTemplate(template, schemas) {
  const used = new Set();
  for (const page of template.schemas || []) {
    for (const field of page || []) {
      if (field?.type) used.add(field.type);
    }
  }
  if (used.size === 0) ['text', 'image', 'line', 'rect', 'table'].forEach(t => schemas[t] && used.add(t));

  const plugins = {};
  const missing = [];
  used.forEach(t => (schemas[t] ? (plugins[t] = schemas[t]) : missing.push(t)));
  if (missing.length) {
    throw new Error(
      `Template uses unknown/missing plugin(s): ${missing.join(', ')}.`
    );
  }
  return plugins;
}

/** ---- 🔥 FIX: Split TOR data into 2 pages ---- */
function splitTorDataForTemplate(data) {
  return [
    {
      // PAGE 1
      fullName: data.fullName,
      address: data.address,
      entranceCredentials: data.entranceCredentials,
      highSchool: data.highSchool,
      program: data.program,
      major: data.major,
      placeOfBirth: data.placeOfBirth,
      dateAdmission: data.dateAdmission,
      dateOfBirth: data.dateOfBirth,
      dateGraduated: data.dateGraduated,
      dateIssued: data.dateIssued,
      rows_page1: data.rows_page1 || [],
    },
    {
      // PAGE 2
      fullName_page2: data.fullName,
      rows_page2: data.rows_page2 || [],
    }
  ];
}

/** -------- Main builder -------- */
async function build(kind, data) {
  const { generate, schemas } = await ensurePdfme();
  const template = await loadTemplate(kind);

  template.basePdf = await resolveBasePdfBytes(kind, template.basePdf);
  const plugins = buildPluginsForTemplate(template, schemas);
  const font = await loadFonts();

  const inputs =
    kind === 'tor'
      ? splitTorDataForTemplate(data)
      : [data];

  const pdfBytes = await generate({
    template,
    plugins,
    inputs,
    options: { font },
  });

  return pdfBytes;
}

/** -------- Controllers -------- */
const torSamplePdf = async (req, res, next) => {
  try {
    const bytes = await build('tor', await loadSample('tor'));
    sendPdf(res, bytes, 'tor.pdf');
  } catch (e) { next(e); }
};
const diplomaSamplePdf = async (req, res, next) => {
  try {
    const bytes = await build('diploma', await loadSample('diploma'));
    sendPdf(res, bytes, 'diploma.pdf');
  } catch (e) { next(e); }
};
const torGeneratePdf = async (req, res, next) => {
  try {
    const bytes = await build('tor', req.body || {});
    sendPdf(res, bytes, 'tor.pdf');
  } catch (e) { next(e); }
};
const diplomaGeneratePdf = async (req, res, next) => {
  try {
    const bytes = await build('diploma', req.body || {});
    sendPdf(res, bytes, 'diploma.pdf');
  } catch (e) { next(e); }
};

module.exports = {
  torSamplePdf,
  diplomaSamplePdf,
  torGeneratePdf,
  diplomaGeneratePdf,
};
