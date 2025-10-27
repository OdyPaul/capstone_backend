// middleware/validate.js
const { z } = require('zod');

exports.z = z;

exports.objectId = () =>
  z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

exports.validate = (schema = {}) => (req, res, next) => {
  try {
    if (schema.body)   req.body   = schema.body.parse(req.body);
    if (schema.params) {
      const parsed = schema.params.parse(req.params);
      Object.keys(req.params).forEach(k => delete req.params[k]);
      Object.assign(req.params, parsed);  // ✅ mutate, don’t reassign the property
    }
    if (schema.query) {
      const parsed = schema.query.parse(req.query);
      Object.keys(req.query).forEach(k => delete req.query[k]);
      Object.assign(req.query, parsed);   // ✅ mutate, don’t reassign the property
    }
    next();
  } catch (e) {
    return res.status(400).json({
      message: 'Invalid input',
      details: e.errors || String(e),
    });
  }
};
