// middleware/mongoSanitizeSafe.js
// Mutates req.body/req.params/req.query in place (no reassignments)

function isPojo(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function sanitizeInPlace(obj, replaceWith = "_") {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) sanitizeInPlace(item, replaceWith);
    return;
  }

  for (const key of Object.keys(obj)) {
    // block prototype pollution
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      delete obj[key];
      continue;
    }

    const val = obj[key];
    const needsRename = key.includes("$") || key.includes(".");

    if (needsRename) {
      const safeKey = key.replace(/\$/g, replaceWith).replace(/\./g, replaceWith);
      delete obj[key];
      if (safeKey) obj[safeKey] = val;
    }

    const nextVal = needsRename ? obj[key.replace(/\$|\./g, replaceWith)] : val;
    if (isPojo(nextVal) || Array.isArray(nextVal)) {
      sanitizeInPlace(nextVal, replaceWith);
    }
  }
}

function mongoSanitizeSafe(options = {}) {
  const replaceWith = typeof options.replaceWith === "string" ? options.replaceWith : "_";
  return function (req, _res, next) {
    if (req.body)   sanitizeInPlace(req.body, replaceWith);
    if (req.params) sanitizeInPlace(req.params, replaceWith);
    if (req.query)  sanitizeInPlace(req.query, replaceWith); // mutate, don't reassign
    next();
  };
}

module.exports = { mongoSanitizeSafe };
