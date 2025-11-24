// routes/mobile/pushRoutes.js
const express = require('express');
const router = express.Router();
const { redis } = require('../../lib/redis');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');
const { protect } = require('../../middleware/authMiddleware'); // 👈 add this

const RL_REGISTER = rateLimitRedis({ prefix: 'rl:push:register', windowMs: 60_000, max: 60 });

function isExpoPushToken(token) {
  if (typeof token !== 'string') return false;
  return (
    /^ExponentPushToken\[[\w\-.]+\]$/.test(token) ||
    /^ExpoPushToken\[[\w\-.]+\]$/.test(token)
  );
}

router.post('/push/register', protect, RL_REGISTER, async (req, res) => {  // 👈 add `protect`
  try {
    const userId = req.user?._id?.toString();                              // 👈 simpler & sure
    const { token } = req.body || {};

    if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });
    if (!isExpoPushToken(token)) return res.status(400).json({ ok: false, message: 'Invalid Expo push token' });
    if (!redis) return res.status(500).json({ ok: false, message: 'Redis not available' });

    await redis.sadd(`user:devices:${userId}`, token);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'failed' });
  }
});

module.exports = router;
