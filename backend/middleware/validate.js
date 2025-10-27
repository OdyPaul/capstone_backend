// middleware/validate.js
// Option A: mutate req.query in place (fixes "Cannot set property query...")
// + exports objectId() for Mongo-style 24-hex IDs

const { z, ZodError } = require("zod");

// ---------------- helpers ----------------
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

/**
 * objectId({ coerce? = false, label? = 'id' })
 * Usage: z.object({ id: objectId() })
 *        z.array(objectId())
 *        z.object({ draft: objectId().optional() })
 */
function objectId(opts = {}) {
  const { coerce = false, label = "id" } = opts;
  const base = coerce ? z.coerce.string() : z.string();
  return base
    .trim()
    .refine((v) => OBJECT_ID_RE.test(v), {
      message: `Invalid ObjectId for ${label}`,
    });
}

// Mutate the target object in place: clear keys then copy from src
function copyInPlace(target, src) {
  if (!target || typeof target !== "object") return; // safety
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

module.exports = { z, validate, objectId };
