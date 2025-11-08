// queues/vc.queue.js
const { Queue, Worker } = require('bullmq'); // QueueScheduler not needed from v2+
const { redis, pub } = require('../lib/redis');             // ⬅️ merge import
const SignedVC = require('../models/web/signedVcModel');
const { commitBatch } = require('../services/anchorBatchService');

// Prefer shared redis; fallback to REDIS_URL if present
const connection = redis || (process.env.REDIS_URL ? { url: process.env.REDIS_URL } : null);

const queueName = 'vc-requests';
const vcQueue = connection ? new Queue(queueName, { connection }) : null;

async function enqueueAnchorNow(credId) {
  if (!vcQueue) return;

  // Dedupe per-VC "now" jobs
  const jobId = `anchor-now:${credId}`;
  try {
    await vcQueue.add(
      'anchor-now',
      { credId },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
        removeOnFail: 25,
      }
    );

    // Notify UI that a VC was queued
    if (pub) {
      pub.publish('events', JSON.stringify({
        type: 'vc:queued',
        credId,
        ts: Date.now(),
      }));
    }
  } catch (e) {
    // Ignore duplicate jobId errors
    if (!/already exists/i.test(String(e?.message || ''))) throw e;
  }
}

// Worker
if (connection) {
  new Worker(
    queueName,
    async (job) => {
      if (job.name !== 'anchor-now') return;
      const { credId } = job.data;

      const doc = await SignedVC.findById(credId)
        .select('_id digest status anchoring')
        .lean();

      if (!doc) throw new Error('VC not found');
      if (doc.status !== 'active') throw new Error('VC not active');

      // If already anchored, return gracefully
      if (doc.anchoring?.state === 'anchored') {
        return {
          message: 'Already anchored',
          batch_id: doc?.anchoring?.batch_id || null,
          txHash: doc?.anchoring?.tx_hash || null,
        };
      }

      // Allow approved single OR "now" mode
      const ok =
        doc.anchoring?.state === 'queued' &&
        (doc.anchoring?.approved_mode === 'single' || doc.anchoring?.queue_mode === 'now');

      if (!ok) throw new Error('VC not queued for anchoring');

      try {
        // commitBatch now publishes vc:anchored/batch:anchored itself
        const r = await commitBatch([doc], 'single');
        return r;
      } catch (err) {
        // Emit a failure event so UIs can surface it
        if (pub) {
          pub.publish('events', JSON.stringify({
            type: 'vc:anchor_failed',
            credId,
            error: String(err?.message || err),
            ts: Date.now(),
          }));
        }
        throw err;
      }
    },
    { connection, concurrency: 1 }
  );
}

module.exports = { vcQueue, enqueueAnchorNow };
