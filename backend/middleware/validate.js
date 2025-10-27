// middleware/validate.js
const { z } = require('zod');
exports.z = z;

exports.objectId = () =>
  z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId');

exports.validate = (schema = {}) => (req, res, next) => {
  try {
    if (schema.body) {
      const parsed = schema.body.parse(req.body);
      for (const k of Object.keys(req.body || {})) delete req.body[k];
      Object.assign(req.body, parsed);
    }
    if (schema.query) {
      const parsed = schema.query.parse(req.query);
      for (const k of Object.keys(req.query || {})) delete req.query[k];
      Object.assign(req.query, parsed);
    }
    if (schema.params) {
      const parsed = schema.params.parse(req.params);
      for (const k of Object.keys(req.params || {})) delete req.params[k];
      Object.assign(req.params, parsed);
    }
    next();
  } catch (e) {
    return res.status(400).json({
      message: 'Invalid input',
      details: e.errors || String(e),
    });
  }
};
