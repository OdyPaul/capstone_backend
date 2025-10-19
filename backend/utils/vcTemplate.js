// utils/vcTemplate.js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), obj);
}

function coerce(value, type) {
  if (value == null) return value;
  switch (type) {
    case 'string': return String(value);
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return ['true','1','yes','y'].includes(value.toLowerCase());
      if (typeof value === 'number') return value !== 0;
      return null;
    }
    case 'date': {
      const d = value instanceof Date ? value : new Date(value);
      return isNaN(d) ? null : new Date(d).toISOString();
    }
    case 'array': return Array.isArray(value) ? value : (value == null ? [] : [value]);
    case 'object': return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    default: return value;
  }
}

/**
 * Build initial draft.data from template fields and student doc
 * Priority: overrides[key] > student[path] > default per type
 */
function buildDataFromTemplate(template, student, overrides = {}) {
  const out = {};
  const attrs = Array.isArray(template?.attributes) ? template.attributes : [];

  for (const a of attrs) {
    const key = a.key;
    const type = a.type || 'string';
    if (!key) continue;

    let value = Object.prototype.hasOwnProperty.call(overrides, key)
      ? overrides[key]
      : undefined;

    if (value === undefined && a.path) {
      value = getByPath(student, a.path);
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

/**
 * Minimal validation: required + basic type soundness
 */
function validateAgainstTemplate(template, data = {}) {
  const errors = [];
  const attrs = Array.isArray(template?.attributes) ? template.attributes : [];

  for (const a of attrs) {
    const key = a.key;
    const type = a.type || 'string';
    const val = data[key];

    // required
    if (a.required) {
      const empty =
        val === null || val === undefined ||
        (type === 'string' && String(val).trim() === '') ||
        (type === 'array' && Array.isArray(val) && val.length === 0) ||
        (type === 'object' && val && Object.keys(val).length === 0);
      if (empty) errors.push(`"${a.title || key}" is required.`);
    }

    // simple type checks
    if (val != null) {
      const coerced = coerce(val, type);
      if (coerced === null && type !== 'string') {
        errors.push(`"${a.title || key}" must be a valid ${type}.`);
      }
    }

    // optional: basic email sanity if key hints email (you can remove this)
    if (/email/i.test(key) && val) {
      if (typeof val !== 'string' || !EMAIL_RE.test(val)) {
        errors.push(`"${a.title || key}" must be a valid email.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { buildDataFromTemplate, validateAgainstTemplate };
