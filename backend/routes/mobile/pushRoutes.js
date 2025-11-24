// routes/mobile/pushRoutes.js
const express = require('express');
const router = express.Router();
const { redis } = require('../../lib/redis');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');
const { protect } = require('../../middleware/authMiddleware'); // ✅ make sure this exposes req.user.id

const RL_REGISTER = rateLimitRedis({ prefix: 'rl:push:register', windowMs: 60_000, max: 60 });

function isExpoPushToken(token) {
  if (typeof token !== 'string') return false;
  return /^ExponentPushToken\[[\w\-.]+\]$/.test(token) || /^ExpoPushToken\[[\w\-.]+\]$/.test(token);
}
function getUserId(req) {
  return req?.user?.id || req?.auth?.userId || null;
}

// Save Expo token for the signed-in user
router.post('/push/register', protect, RL_REGISTER, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { token } = req.body || {};
    if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });
    if (!isExpoPushToken(token)) return res.status(400).json({ ok: false, message: 'Invalid Expo push token' });
    if (!redis) return res.status(500).json({ ok: false, message: 'Redis not available' });

    await redis.sadd(`user:devices:${userId}`, token);
    // Optional rolling expiry:
    // await redis.expire(`user:devices:${userId}`, 60 * 60 * 24 * 30);

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || 'failed' });
  }
});

// 🔎 Debug: list my saved tokens
router.get('/push/debug/tokens', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });
    if (!redis) return res.json({ ok: true, count: 0, tokens: [] });
    const tokens = await redis.smembers(`user:devices:${userId}`);
    return res.json({ ok: true, count: tokens.length, tokens });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || 'failed' });
  }
});

module.exports = router;
