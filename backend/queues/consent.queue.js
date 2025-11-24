// queues/consent.queue.js
// --- Polyfill for Node < 18 ---
if (typeof fetch === 'undefined') {
  const { fetch, Headers, Request, Response } = require('undici');
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

const { Queue, Worker, QueueEvents } = require('bullmq');
const { redis } = require('../lib/redis');

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

// Use same connection for queue + worker
const connection =
  redis || (process.env.REDIS_URL ? { url: process.env.REDIS_URL } : null);

const queueName = 'consent-push';
const consentQueue = connection ? new Queue(queueName, { connection }) : null;

/* helpers */
function isExpoPushToken(token) {
  if (typeof token !== 'string') return false;
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

async function allowUserPush(userId, windowSec = 300, max = 3) {
  // Rate limit per user (requires redis client)
  if (!redis) return true;
  const key = `consent:rate:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return count <= max;
}

/* enqueue */
async function enqueueConsentPush({
  userId,
  sessionId,
  nonce,
  org,
  purpose,
  title,
  body,
}) {
  if (!consentQueue) {
    console.warn('[enqueueConsentPush] consentQueue not initialized (no connection)');
    return;
  }
  if (!userId || !sessionId) {
    console.warn('[enqueueConsentPush] missing userId or sessionId', {
      userId,
      sessionId,
    });
    return;
  }

  const ok = await allowUserPush(userId, 300, 3);
  if (!ok) {
    console.warn('[enqueueConsentPush] rate-limited for user', userId);
    return;
  }

  // IMPORTANT: jobId CANNOT contain ':'
  const jobId = `consent_${sessionId}`;

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
        body:
          body ||
          'A verifier is asking permission to view your credential.',
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 25,
      }
    );
    console.log('[push] enqueued consent job', jobId, 'for user', userId);
  } catch (e) {
    console.warn(
      '[enqueueConsentPush] failed to enqueue job',
      jobId,
      'error =',
      e?.message || e
    );
    // Only swallow duplicate-job errors
    if (!/already exists/i.test(String(e?.message || ''))) {
      throw e;
    }
  }
}

/* sender */
async function sendToExpoHTTP(userId, payload) {
  if (!redis) {
    console.warn('[push] redis not available in sendToExpoHTTP');
    return;
  }

  const tokens = await redis.smembers(`user:devices:${userId}`);
  console.log('[push] tokens for user', userId, tokens.length);

  if (!tokens?.length) return;

  const valid = tokens.filter(isExpoPushToken);
  if (!valid.length) {
    console.warn('[push] no valid Expo tokens for user', userId);
    return;
  }

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

  const batches = chunk(messages, 90);
  for (const batch of batches) {
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        try {
          const text = await res.text();
          console.warn(
            '[expo-push:http-status]',
            res.status,
            text
          );
        } catch {}
        continue;
      }

      const data = await res.json().catch(() => null);
      console.log('[expo-push:response]', JSON.stringify(data));

      if (!data || !Array.isArray(data.data)) continue;

      data.data.forEach((ticket, i) => {
        if (ticket.status !== 'ok') {
          const to = batch[i]?.to;
          console.warn(
            '[expo-push:error]',
            to,
            ticket?.message || ticket?.details || ticket
          );
        }
      });
    } catch (err) {
      console.warn('[expo-push:http-error]', err?.message || err);
    }
  }
}

/* worker */
if (connection) {
  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name !== 'consent-requested') return;
      const { userId } = job.data || {};
      console.log(
        '[worker]',
        queueName,
        'processing job',
        job.id,
        'for user',
        userId
      );
      await sendToExpoHTTP(userId, job.data);

      // cache pending
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
        await redis.expire(pendingKey, 60 * 60 * 24 * 7);
      } catch (e) {
        console.warn(
          '[consent:pending-cache] failed:',
          e?.message || e
        );
      }
    },
    { connection, concurrency: 4 }
  );

  const events = new QueueEvents(queueName, { connection });
  events.on('failed', ({ jobId, failedReason }) =>
    console.warn(`[${queueName}] job ${jobId} failed:`, failedReason)
  );
  events.on('completed', ({ jobId }) => {
    // console.log(`[${queueName}] job ${jobId} completed`);
  });

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
