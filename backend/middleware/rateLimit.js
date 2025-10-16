// middleware/rateLimit.js
const hits = new Map();

function rateLimit(options = {}) {
  const { windowMs = 60000, max = 30 } = options;

  return function (req, res, next) {
    const key = `${req.ip}|${req.path}`;
    const now = Date.now();
    const list = hits.get(key)?.filter(ts => now - ts < windowMs) || [];
    list.push(now);
    hits.set(key, list);
    if (list.length > max) {
      console.warn('Rate-limit triggered for', key);
      return res.status(429).json({ message: 'Too many requests' });
    }
    next();
  };
}

module.exports = rateLimit;
