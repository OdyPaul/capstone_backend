// routes/mobile/pushRoutes.js
const express = require('express');
const router = express.Router();

const { redis } = require('../../lib/redis');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');

const RL_REGISTER = rateLimitRedis({ prefix: 'rl:push:register', windowMs: 60_000, max: 60 });

/** Get the signed-in user's id from your auth middleware */
function getUserId(req) {
  return req?.auth?.userId || req?.user?.id || null;
}

/** Minimal Expo token validator (no expo-server-sdk needed) */
function isExpoPushToken(token) {
  if (typeof token !== 'string') return false;
  // Supports both legacy and new formats
  return (
    /^ExponentPushToken\[[\w\-.]+\]$/.test(token) ||
    /^ExpoPushToken\[[\w\-.]+\]$/.test(token)
  );
}

/**
 * Register device push token(s) for the current user.
 * Body: { token: string } OR { tokens: string[] }
 */
router.post('/push/register', RL_REGISTER, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });

    if (!redis) return res.status(500).json({ ok: false, message: 'Redis not available' });

    const body = req.body || {};
    let tokens = [];

    if (Array.isArray(body.tokens)) tokens = body.tokens;
    else if (body.token) tokens = [body.token];

    // Basic input checking
    tokens = (tokens || []).filter(Boolean).map(String);
    if (!tokens.length) {
      return res.status(400).json({ ok: false, message: 'Missing "token" or "tokens" in body' });
    }

    // Validate all tokens
    for (const t of tokens) {
      if (!isExpoPushToken(t)) {
        return res.status(400).json({ ok: false, message: `Invalid Expo push token: ${t}` });
      }
    }

    // Store in a per-user device set
    const key = `user:devices:${userId}`;
    if (tokens.length === 1) {
      await redis.sadd(key, tokens[0]);
    } else {
      await redis.sadd(key, ...tokens);
    }

    // Optional rolling expiry (uncomment if desired)
    // await redis.expire(key, 60 * 60 * 24 * 30); // 30 days

    return res.json({ ok: true, count: tokens.length });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || 'failed' });
  }
});

/**
 * Optional: unregister a token (if you want a cleanup endpoint)
 * Body: { token: string }
 */
// router.post('/push/unregister', async (req, res) => {
//   try {
//     const userId = getUserId(req);
//     if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });
//     if (!redis) return res.status(500).json({ ok: false, message: 'Redis not available' });
//
//     const token = String(req.body?.token || '');
//     if (!token) return res.status(400).json({ ok: false, message: 'Missing "token"' });
//
//     await redis.srem(`user:devices:${userId}`, token);
//     return res.json({ ok: true });
//   } catch (e) {
//     return res.status(500).json({ ok: false, message: e?.message || 'failed' });
//   }
// });

module.exports = router;
