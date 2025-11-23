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

/** -------- Paths (pdf-build lives under backend/) -------- */
const ROOT = path.join(__dirname, '../../'); // -> backend/
const BUILD_DIR = path.join(ROOT, 'pdf-build');
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
    // Minimal fallback so you can at least see a PDF if sample is missing
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
          rows: [
            { term: '1st Sem 2021–2022', code: 'ENG 101', desc: 'Communication Arts 1', final: '1.75', reexam: '', units: '3' },
            { term: '', code: 'MATH 101', desc: 'College Algebra', final: '2.00', reexam: '', units: '3' }
          ]
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
  // Supply whatever TTF/OTF you’ve placed in backend/pdf-build/fonts
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

/** -------- Base PDF resolver --------
 * Accepts:
 *  - data URL string (data:application/pdf;base64,.....)
 *  - relative or absolute file path to a .pdf
 *  - missing -> falls back to backend/pdf-build/<kind>/base.pdf
 */
async function resolveBasePdfBytes(kind, basePdfValue) {
  const baseDir = kind === 'tor' ? TOR_DIR : DIP_DIR;

  // If template has a data URL
  if (typeof basePdfValue === 'string' && basePdfValue.startsWith('data:')) {
    const b64 = basePdfValue.split(',')[1] || '';
    return Buffer.from(b64, 'base64');
  }

  // If template has a path-like string, resolve it (relative to its build dir)
  if (typeof basePdfValue === 'string' && basePdfValue.trim()) {
    const p = path.isAbsolute(basePdfValue)
      ? basePdfValue
      : path.join(baseDir, basePdfValue);
    return fs.readFile(p);
  }

  // Fallback: backend/pdf-build/<kind>/base.pdf
  const fallback = path.join(baseDir, 'base.pdf');
  if (await fileExists(fallback)) {
    return fs.readFile(fallback);
  }

  // No base found -> throw a helpful error
  const where = kind === 'tor' ? 'pdf-build/tor' : 'pdf-build/diploma';
  throw new Error(
    `No base PDF found. Put your base at "${where}/base.pdf" or set a valid data URL/path in template.basePdf.`
  );
}

/** -------- Build plugin map from template usage --------
 * Only register plugins your template actually uses AND that exist in the installed schemas.
 * Clear error if a required plugin is missing (e.g. "table" not exported by your version).
 */
function buildPluginsForTemplate(template, schemas) {
  const usedTypes = new Set();
  for (const page of template.schemas || []) {
    for (const field of page || []) {
      if (field && typeof field.type === 'string') usedTypes.add(field.type);
    }
  }
  // If no fields yet (empty template), still provide text/image/line basics safely when available
  if (usedTypes.size === 0) {
    ['text', 'image', 'line', 'rect', 'table'].forEach(t => {
      if (schemas[t]) usedTypes.add(t);
    });
  }

  const plugins = {};
  const missing = [];
  usedTypes.forEach(t => {
    if (schemas[t]) plugins[t] = schemas[t];
    else missing.push(t);
  });

  if (missing.length) {
    throw new Error(
      `Your template uses unknown/missing plugin(s): ${missing.join(', ')}. ` +
      `Install a schemas version that exports them, or remove these field types from the template.`
    );
  }
  return plugins;
}

/** -------- Main builder -------- */
async function build(kind, data) {
  const { generate, schemas } = await ensurePdfme();
  const template = await loadTemplate(kind);

  // Ensure basePdf is actual bytes
  template.basePdf = await resolveBasePdfBytes(kind, template.basePdf);

  // Only register plugins your template needs & your installed version provides
  const plugins = buildPluginsForTemplate(template, schemas);

  const font = await loadFonts();

  const pdfBytes = await generate({
    template,
    plugins,
    inputs: [data],
    options: { font },
  });
  return pdfBytes;
}

/** -------- Controllers -------- */
// Quick-open sample (GET)
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

// Generate from real payload (POST)
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
