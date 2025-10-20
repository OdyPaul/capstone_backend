// backend/utils/vcTemplate.js
const getByPath = (obj, path) => {
  if (!path) return undefined;
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
};

function coerce(v, type) {
  if (v == null) return v;
  switch (type) {
    case 'number': return Number(v);
    case 'boolean': return Boolean(v);
    case 'date': return (v instanceof Date) ? v : new Date(v);
    case 'array': return Array.isArray(v) ? v : (v == null ? [] : [v]);
    case 'object': return (v && typeof v === 'object') ? v : {};
    default: return v;
  }
}

function titleCase(s = '') {
  return String(s)
    .toLowerCase()
    .replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
}

function computeDegreeTitle(student, curriculumDoc) {
  const curriculumTitle = curriculumDoc?.longName || curriculumDoc?.degreeTitle;
  if (curriculumTitle) return curriculumTitle;

  const raw = String(student?.program || '').trim();
  if (!raw) return '';

  const norm = raw.replace(/\s+/g, ' ').replace(/^[\s\-]+|[\s\-]+$/g, '');

  const mBS = norm.match(/^B\.?\s*S\.?\s*(?:in)?\s*(.+)$/i);
  if (mBS) return `Bachelor of Science in ${titleCase(mBS[1])}`;

  const mBA = norm.match(/^B\.?\s*A\.?\s*(?:in)?\s*(.+)$/i);
  if (mBA) return `Bachelor of Arts in ${titleCase(mBA[1])}`;

  const mB = norm.match(/^B(?:achelor)?\s*(?:of)?\s*(.+)$/i);
  if (mB) return `Bachelor of ${titleCase(mB[1])}`;

  return titleCase(norm);
}

function buildDataFromTemplate(template, student, overrides = {}, curriculumDoc = null) {
  const out = {};
  const attrs = Array.isArray(template?.attributes) ? template.attributes : [];

  for (const a of attrs) {
    const key = a.key;
    const type = a.type || 'string';
    if (!key) continue;

    let value =
      Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;

    if (value === undefined) {
      if (key === 'degreeTitle') {
        value = computeDegreeTitle(student, curriculumDoc);
      } else if (a.path) {
        value = getByPath(student, a.path);
      }
    }

    if (value === undefined) {
      if (type === 'array') value = [];
      else if (type === 'object') value = {};
      else value = null;
    }

    out[key] = coerce(value, type);
  }
  return out;
}

function validateAgainstTemplate(template, data) {
  const attrs = Array.isArray(template?.attributes) ? template.attributes : [];
  const errors = [];
  for (const a of attrs) {
    if (a.required && (data[a.key] === null || data[a.key] === undefined || data[a.key] === "")) {
      errors.push(`Missing required: ${a.key}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { buildDataFromTemplate, validateAgainstTemplate, computeDegreeTitle };
