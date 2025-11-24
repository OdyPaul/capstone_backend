// routes/mobile/pushRoutes.js
const express = require('express');
const router = express.Router();
const { redis } = require('../../lib/redis');
const { rateLimitRedis } = require('../../middleware/rateLimitRedis');
const { protect } = require('../../middleware/authMiddleware');

const RL_REGISTER = rateLimitRedis({
  prefix: 'rl:push:register',
  windowMs: 60_000,
  max: 60,
});

function isExpoPushToken(token) {
  if (typeof token !== 'string') return false;
  return (
    /^ExponentPushToken\[[\w\-.]+\]$/.test(token) ||
    /^ExpoPushToken\[[\w\-.]+\]$/.test(token)
  );
}

// 🔴 main route
router.post('/push/register', protect, RL_REGISTER, async (req, res) => {
  try {
    // ✅ use same pattern as listPending + fallback to _id
    const rawUserId =
      req?.auth?.userId ||
      req?.user?.id ||
      req?.user?._id ||
      null;

    const userId = rawUserId ? String(rawUserId) : null;
    const { token } = req.body || {};

    if (!userId) {
      console.warn('[push/register] missing userId');
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }

    if (!isExpoPushToken(token)) {
      console.warn('[push/register] invalid token', token);
      return res
        .status(400)
        .json({ ok: false, message: 'Invalid Expo push token' });
    }

    if (!redis) {
      console.error('[push/register] redis not available');
      return res
        .status(500)
        .json({ ok: false, message: 'Redis not available' });
    }

    await redis.sadd(`user:devices:${userId}`, token);

    console.log('[push/register] registered token for user', {
      userId,
      token,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[push/register] error', e);
    res.status(500).json({ ok: false, message: e?.message || 'failed' });
  }
});

module.exports = router;
