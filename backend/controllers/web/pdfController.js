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
          dateIssued: '2025-07-01',
          rows_page1: [],
          rows_page2: []
        }
      : {
          fullName: 'Jane D. Student',
          program: 'BS in Agriculture',
          major: 'Crop Science',
          dateGraduated: '2025-06-19',
          dateIssued: '2025-07-01'
        };
  }
}

/** -------- Fonts (one fallback only) -------- */
async function loadFonts() {
  const regular = await fs.readFile(path.join(FONTS_DIR, 'NotoSans-Regular.ttf'));
  let bold;
  try { bold = await fs.readFile(path.join(FONTS_DIR, 'NotoSans-SemiBold.ttf')); } catch {}

  const font = { NotoSans: { data: regular, fallback: true } };
  if (bold) font.NotoSansSemiBold = { data: bold };

  // Alias to match template's "Roboto"
  font.Roboto = { data: regular };
  return font;
}

function sendPdf(res, bytes, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(Buffer.from(bytes));
}

/** ---- Base PDF resolver ---- */
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
    const p = path.isAbsolute(basePdfValue) ? basePdfValue : path.join(baseDir, basePdfValue.trim());
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
    throw new Error(`Template uses unknown/missing plugin(s): ${missing.join(', ')}.`);
  }
  return plugins;
}

/** ---- Normalizers ---- */
const S = (v) => (v == null ? '' : String(v));
const A = (v) => (Array.isArray(v) ? v : []);

/** Turn any table rows (objects or arrays) into arrays of strings aligned to head. */
function normalizeTableRows(head, value, minRows = 0) {
  const rows = A(value);
  const headArr = A(head).map(S);
  const cols = headArr.length;

  const norm = rows.map((row) => {
    if (Array.isArray(row)) {
      // ensure length and stringify
      const arr = row.slice(0, cols);
      while (arr.length < cols) arr.push('');
      return arr.map(S);
    }
    // object → array by head order
    const out = [];
    for (const h of headArr) out.push(S(row && row[h]));
    return out;
  });

  // pad with empty rows if needed
  while (norm.length < minRows) {
    norm.push(Array.from({ length: cols }, () => ''));
  }
  return norm;
}

/** ---- Normalize TOR input (strings only) ---- */
function normalizeTorInput(data = {}) {
  const fullName = S(data.fullName || data.fullname || data.name);
  return {
    fullName,
    address: S(data.address),
    entranceCredentials: S(data.entranceCredentials),
    highSchool: S(data.highSchool),
    program: S(data.program),
    major: S(data.major),
    placeOfBirth: S(data.placeOfBirth),
    dateAdmission: S(data.dateAdmission),
    dateOfBirth: S(data.dateOfBirth),
    dateGraduated: S(data.dateGraduated),
    dateIssued: S(data.dateIssued ?? data.issuedDate),
    rows_page1: A(data.rows_page1),
    rows_page2: A(data.rows_page2),
    fullName_page2: S(data.fullName_page2 ?? fullName),
  };
}

/** ---- Sanitize by template: coerce text fields; fix table rows; delete table.content ---- */
function sanitizeByTemplate(template, input) {
  const out = { ...input };

  const pages = Array.isArray(template.schemas) ? template.schemas : [];
  pages.forEach((page) => {
    (page || []).forEach((field) => {
      if (!field || !field.type) return;

      if (field.type === 'text') {
        const key = typeof field.content === 'string' ? field.content : '';
        if (!key) return;
        out[key] = S(out[key]);
      }

      if (field.type === 'table') {
        const key = field.name;
        const head = Array.isArray(field.head) ? field.head : [];
        // 🛡️ Normalize all cells to strings, pad to at least 1 empty row if undefined/empty
        out[key] = normalizeTableRows(head, out[key], /*minRows*/ 1);
        // Avoid table plugin reading stale content
        if ('content' in field) delete field.content;
      }
    });
  });

  return out;
}

/** -------- Main builder -------- */
async function build(kind, data) {
  const { generate, schemas } = await ensurePdfme();
  const template = await loadTemplate(kind);

  // Load base PDF (background)
  const baseBytes = await resolveBasePdfBytes(kind, template.basePdf);
  template.basePdf = baseBytes;
  console.log(`📄 basePdf loaded (${kind}): ${baseBytes.length.toLocaleString()} bytes`);

  const plugins = buildPluginsForTemplate(template, schemas);
  const font = await loadFonts();

  const normalized = kind === 'tor' ? normalizeTorInput(data) : data;
  const safeInput = sanitizeByTemplate(template, normalized);
  const inputs = [safeInput];

  // Preflight logs
  const t1 = (template.schemas?.[0] || []).find(f => f.type === 'table');
  const t2 = (template.schemas?.[1] || []).find(f => f.type === 'table');
  if (t1) console.log(`[preflight] table ${t1.name}: rows=${inputs[0][t1.name]?.length} head=${t1.head?.length} firstRowType=${Array.isArray(inputs[0][t1.name]?.[0]) ? 'array' : typeof inputs[0][t1.name]?.[0]}`);
  if (t2) console.log(`[preflight] table ${t2.name}: rows=${inputs[0][t2.name]?.length} head=${t2.head?.length} firstRowType=${Array.isArray(inputs[0][t2.name]?.[0]) ? 'array' : typeof inputs[0][t2.name]?.[0]}`);

  console.log('🧩 pdfme inputs →', JSON.stringify(inputs, null, 2));

  try {
    const pdfBytes = await generate({
      template,
      plugins,
      inputs,
      options: { font },
    });
    return pdfBytes;
  } catch (e) {
    console.error('❌ pdfme.generate() failed:', e && (e.stack || e.message || e));
    // Extra introspection
    for (const page of template.schemas || []) {
      for (const f of page || []) {
        if (f.type === 'text') {
          const k = f.content;
          console.error(`[text] ${f.name} (${k}) ->`, typeof inputs[0][k], JSON.stringify(inputs[0][k]));
        } else if (f.type === 'table') {
          const k = f.name;
          const v = inputs[0][k];
          console.error(`[table] ${f.name} (${k}) ->`, Array.isArray(v) ? `rows:${v.length}` : typeof v, ' | sampleRow:', JSON.stringify(v?.[0]));
        }
      }
    }
    throw e;
  }
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
