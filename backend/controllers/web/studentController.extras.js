const asyncHandler = require('express-async-handler');
const Student = require('../../models/students/studentModel');

function flattenMongooseSchema(schema, prefix = '') {
  const out = [];
  schema.eachPath((p, st) => {
    // ignore __v and timestamps
    if (['__v','createdAt','updatedAt'].includes(p)) return;

    const full = prefix ? `${prefix}.${p}` : p;
    const options = st?.options || {};
    let type = 'string';

    if (options.type === Number) type = 'number';
    if (options.type === Date) type = 'date';
    if (options.type === Boolean) type = 'boolean';
    if (options.type === String) type = 'string';
    if (Array.isArray(options.type) || Array.isArray(options)) type = 'array';
    if (st.instance === 'Array') type = 'array';
    if (st.schema) {
      // nested subdocument
      out.push(...flattenMongooseSchema(st.schema, full));
      return;
    }

    out.push({ path: full, type });
  });
  return out;
}

/**
 * GET /api/student/schema
 * Returns a flat list of student field paths & inferred types.
 */
exports.getStudentSchema = asyncHandler(async (_req, res) => {
  const list = flattenMongooseSchema(Student.schema);
  // simple “pretty” title suggestion from last segment
  const enrich = list.map(({ path, type }) => {
    const last = path.split('.').pop();
    const title = last
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
    return { path, type, suggestedTitle: title };
  });
  res.json(enrich);
});
