// middleware/validate.js
// Option A: mutate req.query in place to avoid
// "Cannot set property query of #<IncomingMessage> which has only a getter"

const { z, ZodError } = require("zod");

// Mutate the target object in place: clear keys then copy from src
function copyInPlace(target, src) {
  for (const k of Object.keys(target)) delete target[k];
  if (src && typeof src === "object") {
    for (const [k, v] of Object.entries(src)) target[k] = v;
  }
}

function formatZodError(err) {
  if (!(err instanceof ZodError)) {
    return { message: err?.message || "Bad Request" };
  }
  const issues = err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
    code: i.code,
  }));
  return {
    message: issues[0]?.message || "Validation failed",
    errors: issues,
  };
}

/**
 * validate({ body?, query?, params? })
 * - Uses zod schemas you pass in.
 * - Reassigns req.body / req.params (safe).
 * - MUTATES req.query in place (never reassigns).
 */
function validate(schema = {}) {
  return (req, res, next) => {
    try {
      if (schema.body) {
        const parsed = schema.body.parse(req.body ?? {});
        req.body = parsed; // reassign is fine for body
      }

      if (schema.params) {
        const parsed = schema.params.parse(req.params ?? {});
        req.params = parsed; // reassign is fine for params
      }

      if (schema.query) {
        const parsed = schema.query.parse(req.query ?? {});
        // IMPORTANT: mutate req.query in place; do NOT do `req.query = parsed`
        copyInPlace(req.query, parsed);
      }

      return next();
    } catch (err) {
      const payload = formatZodError(err);
      return res.status(400).json(payload);
    }
  };
}

module.exports = { z, validate };
