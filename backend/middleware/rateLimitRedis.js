const { redis } = require('../lib/redis');

// in-memory fallback (your old logic, scoped inside this file)
const localHits = new Map();

function localLimit({ key, windowMs, max }) {
  const now = Date.now();
  const list = localHits.get(key)?.filter(ts => now - ts < windowMs) || [];
  list.push(now);
  localHits.set(key, list);
  return list.length <= max;
}

/**
 * Fixed-window limiter using Redis INCR + EXPIRE (fallback to local Map).
 * Example:
 *   rateLimitRedis({ prefix:'rl:login', windowMs:60_000, max:5, keyFn: (req)=> req.body?.email || req.ip })
 */
function rateLimitRedis({ prefix, windowMs = 60_000, max = 30, keyFn = (req) => req.ip }) {
  return async function (req, res, next) {
    try {
      const id = await Promise.resolve(keyFn(req));
      const key = `${prefix}:${id}`;

      // Fallback to local limiter if no Redis
      if (!redis) {
        const ok = localLimit({ key, windowMs, max });
        if (!ok) return res.status(429).json({ message: 'Too many requests' });
        return next();
      }

      // Redis path
      const ttlSec = Math.ceil(windowMs / 1000);
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, ttlSec);

      if (count > max) return res.status(429).json({ message: 'Too many requests' });
      return next();
    } catch (e) {
      // Fail-open if limiter errors
      console.warn('rateLimitRedis error:', e.message);
      return next();
    }
  };
}

module.exports = { rateLimitRedis };
