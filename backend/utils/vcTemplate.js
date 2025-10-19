const get = (obj, path) => path.split('.').reduce((o,p)=> (o ? o[p] : undefined), obj);

function coerceType(val, type) {
  if (val == null) return val;
  if (type === 'number')  return Number(val);
  if (type === 'boolean') return Boolean(val === true || val === 'true' || val === 1 || val === '1');
  if (type === 'date')    return new Date(val);
  if (type === 'array')   return Array.isArray(val) ? val : [val];
  if (type === 'object')  return (typeof val === 'object' ? val : { value: val });
  return String(val);
}

/**
 * Build a data object from a template + a source Student doc (for auto-fill).
 * `overrides` can override mapped values (from the request).
 */
function buildDataFromTemplate(template, studentDoc, overrides = {}) {
  const out = {};
  for (const a of (template.attributes || [])) {
    let val = undefined;

    // mapping from Student
    if (a.mapFrom?.model && a.mapFrom?.path && studentDoc) {
      val = get(studentDoc, a.mapFrom.path);
    }

    // request override (wins)
    if (Object.prototype.hasOwnProperty.call(overrides, a.key)) {
      val = overrides[a.key];
    }

    out[a.key] = coerceType(val, a.type);
  }
  return out;
}

function validateAgainstTemplate(template, data = {}) {
  const errors = [];

  for (const a of (template.attributes || [])) {
    const val = data[a.key];

    if (a.required && (val === undefined || val === null || val === "")) {
      errors.push(`${a.title || a.key} is required`);
      continue;
    }

    if (val == null) continue; // nothing to type/format-check

    // type checks
    if (a.type === 'number'   && Number.isNaN(Number(val))) errors.push(`${a.title || a.key} must be a number`);
    if (a.type === 'date'     && isNaN(new Date(val).getTime())) errors.push(`${a.title || a.key} must be a valid date`);
    if (a.type === 'array'    && !Array.isArray(val)) errors.push(`${a.title || a.key} must be an array`);
    if (a.type === 'object'   && (typeof val !== 'object' || Array.isArray(val))) errors.push(`${a.title || a.key} must be an object`);
    if (a.enum && a.enum.length && !a.enum.includes(String(val))) errors.push(`${a.title || a.key} must be one of: ${a.enum.join(', ')}`);
    if (a.pattern) {
      try {
        const re = new RegExp(a.pattern);
        if (!re.test(String(val))) errors.push(`${a.title || a.key} does not match pattern`);
      } catch { /* bad pattern ignored */ }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { buildDataFromTemplate, validateAgainstTemplate };
