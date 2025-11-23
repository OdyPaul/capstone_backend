// queues/consent.queue.js
const { Queue, Worker, QueueEvents } = require('bullmq');
const { redis } = require('../lib/redis');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

// Reuse your ioredis instance where possible
const connection = redis || (process.env.REDIS_URL ? { url: process.env.REDIS_URL } : null);
const queueName = 'consent-push';

const consentQueue = connection
  ? new Queue(queueName, {
      connection,
      // Optionally throttle global TPS if needed:
      // limiter: { max: 30, duration: 1000 }, // 30 msgs/sec
    })
  : null;

// Per-user rate cap using Redis INCR + EXPIRE
async function allowUserPush(userId, windowSec = 300, max = 3) {
  if (!connection) return true; // fail-open if no Redis
  const key = `consent:rate:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return count <= max;
}

/**
 * Enqueue a consent push (idempotent by sessionId).
 */
async function enqueueConsentPush({ userId, sessionId, nonce, org, purpose, title, body }) {
  if (!consentQueue) return;

  const ok = await allowUserPush(userId, 300, 3);
  if (!ok) return; // silently skip if over user-level cap

  const jobId = `consent:${sessionId}`;
  try {
    await consentQueue.add(
      'consent-requested',
      {
        userId,
        sessionId,
        nonce,
        org: org || '',
        purpose: purpose || '',
        title: title || 'Consent requested',
        body: body || 'A verifier is asking permission to view your credential.',
      },
      {
        jobId, // idempotent per session
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 25,
      }
    );
  } catch (e) {
    if (!/already exists/i.test(String(e?.message || ''))) throw e;
  }
}

async function sendToExpo(userId, payload) {
  // Device tokens stored as a Redis SET by /api/push/register
  const tokens = await redis.smembers(`user:devices:${userId}`);
  if (!tokens?.length) return;

  const messages = tokens.map((t) => ({
    to: t,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: {
      type: 'CONSENT_REQUESTED',
      sessionId: payload.sessionId,
      nonce: payload.nonce,
    },
    priority: 'high',
  }));

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      console.warn('expo push error', err?.message || err);
    }
  }
}

// Worker
if (connection) {
  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name !== 'consent-requested') return;
      const { userId } = job.data;

      // 1) Send push
      await sendToExpo(userId, job.data);

      // 2) Cache "pending" for app UX (badge/list)
      const pendingKey = `consent:pending:${userId}`;
      const item = {
        sessionId: job.data.sessionId,
        nonce: job.data.nonce,
        org: job.data.org,
        purpose: job.data.purpose,
        ts: Date.now(),
      };
      await redis.hset(pendingKey, job.data.sessionId, JSON.stringify(item));
      await redis.expire(pendingKey, 60 * 60 * 24 * 7); // 7 days
    },
    { connection, concurrency: 4 }
  );

  const events = new QueueEvents(queueName, { connection });
  events.on('failed', ({ jobId, failedReason }) => {
    console.warn(`[${queueName}] job ${jobId} failed:`, failedReason);
  });
  events.on('completed', ({ jobId }) => {
    // console.log(`[${queueName}] job ${jobId} completed`);
  });

  // graceful shutdown
  const shutdown = async () => {
    try {
      await worker.close();
      await events.close();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { consentQueue, enqueueConsentPush };
