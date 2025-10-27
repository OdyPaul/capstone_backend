// middleware/validate.js
const { z } = require('zod');

const objectId = () =>
  z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

const validate = (schema = {}) => (req, res, next) => {
  try {
    if (schema.params) req.params = schema.params.parse(req.params);
    if (schema.query)  req.query  = schema.query.parse(req.query);
    if (schema.body)   req.body   = schema.body.parse(req.body);
    next();
  } catch (e) {
    return res.status(400).json({
      message: 'Invalid input',
      errors: e?.errors || String(e),
    });
  }
};

module.exports = { z, validate, objectId };
