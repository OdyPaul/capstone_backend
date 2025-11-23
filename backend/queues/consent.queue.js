// queues/consent.queue.js
const { Queue, Worker, QueueEvents } = require('bullmq');
const { redis } = require('../lib/redis');

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

const connection =
  redis || (process.env.REDIS_URL ? { url: process.env.REDIS_URL } : null);

const queueName = 'consent-push';

const consentQueue = connection
  ? new Queue(queueName, { connection })
  : null;

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
  if (!connection) return true;
  const key = `consent:rate:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return count <= max;
}

/* enqueue */
async function enqueueConsentPush({ userId, sessionId, nonce, org, purpose, title, body }) {
  if (!consentQueue) return;
  const ok = await allowUserPush(userId, 300, 3);
  if (!ok) return;
  const jobId = `consent:${sessionId}`;
  try {
    await consentQueue.add(
      'consent-requested',
      { userId, sessionId, nonce, org: org || '', purpose: purpose || '', title: title || 'Consent requested', body: body || 'A verifier is asking permission to view your credential.' },
      { jobId, attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: 25 }
    );
  } catch (e) {
    if (!/already exists/i.test(String(e?.message || ''))) throw e;
  }
}

/* sender */
async function sendToExpoHTTP(userId, payload) {
  if (!redis) return;
  const tokens = await redis.smembers(`user:devices:${userId}`);
  if (!tokens?.length) return;
  const valid = tokens.filter(isExpoPushToken);
  if (!valid.length) return;

  const messages = valid.map((to) => ({
    to,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: { type: 'CONSENT_REQUESTED', sessionId: payload.sessionId, nonce: payload.nonce },
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
        try { console.warn('[expo-push:http-status]', res.status, await res.text()); } catch {}
        continue;
      }
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.data)) continue;
      data.data.forEach((ticket, i) => {
        if (ticket.status !== 'ok') {
          const to = batch[i]?.to;
          console.warn('[expo-push:error]', to, ticket?.message || ticket?.details || ticket);
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
      const { userId } = job.data;
      await sendToExpoHTTP(userId, job.data);

      // cache pending
      try {
        const pendingKey = `consent:pending:${userId}`;
        const item = { sessionId: job.data.sessionId, nonce: job.data.nonce, org: job.data.org, purpose: job.data.purpose, ts: Date.now() };
        await redis.hset(pendingKey, job.data.sessionId, JSON.stringify(item));
        await redis.expire(pendingKey, 60 * 60 * 24 * 7);
      } catch (e) {
        console.warn('[consent:pending-cache] failed:', e?.message || e);
      }
    },
    { connection, concurrency: 4 }
  );

  const events = new QueueEvents(queueName, { connection });
  events.on('failed', ({ jobId, failedReason }) => console.warn(`[${queueName}] job ${jobId} failed:`, failedReason));
  events.on('completed', () => {});
  const shutdown = async () => { try { await worker.close(); await events.close(); } catch {} process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { consentQueue, enqueueConsentPush };
