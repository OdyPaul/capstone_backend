// routes/mobile/pushRoutes.js
const express = require('express');
const router = express.Router();
const { redis } = require('../../lib/redis');
const { Expo } = require('expo-server-sdk');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');

const RL_REGISTER = rateLimitRedis({ prefix: 'rl:push:register', windowMs: 60_000, max: 60 });

// Helper: extract user id from your auth layer
function getUserId(req) {
  return req?.auth?.userId || req?.user?.id || null;
}

router.post('/push/register', RL_REGISTER, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { token } = req.body || {};
    if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });

    if (!Expo.isExpoPushToken(token)) {
      return res.status(400).json({ ok: false, message: 'Invalid Expo push token' });
    }
    if (!redis) return res.status(500).json({ ok: false, message: 'Redis not available' });

    await redis.sadd(`user:devices:${userId}`, token);
    // Optional: rolling expiry
    // await redis.expire(`user:devices:${userId}`, 60 * 60 * 24 * 30);

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || 'failed' });
  }
});

module.exports = router;
