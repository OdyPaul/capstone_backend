// queues/consent.queue.js
const axios = require('axios');
const { Queue, Worker, QueueEvents } = require('bullmq');
const { redis } = require('../lib/redis');

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

// Reuse your ioredis instance where possible
const connection =
  redis || (process.env.REDIS_URL ? { url: process.env.REDIS_URL } : null);

const queueName = 'consent-push';

const consentQueue = connection
  ? new Queue(queueName, {
      connection,
      // Optionally throttle global TPS if needed:
      // limiter: { max: 30, duration: 1000 }, // 30 msgs/sec
    })
  : null;

/* ------------------------- helpers ------------------------- */

function isExpoPushToken(token) {
  if (typeof token !== 'string') return false;
  // Accept both legacy and new formats
  return (
    /^ExponentPushToken\[[\w\-.]+\]$/.test(token) ||
    /^ExpoPushToken\[[\w\-.]+\]$/.test(token)
  );
}

function chunk(arr, size = 90) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Per-user rate cap using Redis INCR + EXPIRE
async function allowUserPush(userId, windowSec = 300, max = 3) {
  if (!connection) return true; // fail-open if no Redis
  const key = `consent:rate:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return count <= max;
}

/* ------------------------- enqueue API ------------------------- */

/**
 * Enqueue a consent push (idempotent by sessionId).
 */
async function enqueueConsentPush({
  userId,
  sessionId,
  nonce,
  org,
  purpose,
  title,
  body,
}) {
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

/* --------------------- HTTP push sender ---------------------- */

async function sendToExpoHTTP(userId, payload) {
  if (!redis) return;

  // Device tokens stored as a Redis SET by /api/push/register
  const tokens = await redis.smembers(`user:devices:${userId}`);
  if (!tokens?.length) return;

  const valid = tokens.filter(isExpoPushToken);
  if (!valid.length) return;

  const messages = valid.map((to) => ({
    to,
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

  // Expo allows up to 100 messages per request
  const batches = chunk(messages, 90);

  for (const batch of batches) {
    try {
      const res = await axios.post(EXPO_PUSH_ENDPOINT, batch, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
      });

      const data = res?.data;
      // Response shape: { data: [{ status: 'ok' | 'error', ... }, ...] }
      if (!data || !Array.isArray(data.data)) continue;

      data.data.forEach((ticket, i) => {
        if (ticket.status !== 'ok') {
          const t = batch[i]?.to;
          console.warn(
            '[expo-push:error]',
            t,
            ticket?.message || ticket?.details || ticket
          );
        }
      });
    } catch (err) {
      console.warn('[expo-push:http-error]', err?.message || err);
    }
  }
}

/* ------------------------ worker wiring ---------------------- */

if (connection) {
  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name !== 'consent-requested') return;
      const { userId } = job.data;

      // 1) Send push via HTTP
      await sendToExpoHTTP(userId, job.data);

      // 2) Cache "pending" for app UX (badge/list)
      try {
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
      } catch (e) {
        console.warn('[consent:pending-cache] failed:', e?.message || e);
      }
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
