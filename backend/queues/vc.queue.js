const { Queue, Worker, QueueScheduler } = require('bullmq');
const { redis } = require('../lib/redis');
const SignedVC = require('../models/web/signedVcModel');
const { pub } = require('../lib/redis');
const { commitBatch } = require('../controllers/web/anchorController');

// Prefer the shared redis instance; fall back to REDIS_URL if present
const connection = redis || (process.env.REDIS_URL ? { url: process.env.REDIS_URL } : null);

const queueName = 'vc-requests';
const vcQueue = connection ? new Queue(queueName, { connection }) : null;
if (connection) new QueueScheduler(queueName, { connection });

async function enqueueAnchorNow(credId) {
  if (!vcQueue) return;
  await vcQueue.add('anchor-now', { credId }, { attempts: 3, backoff: { type: 'exponential', delay: 3000 } });
}

// Worker
if (connection) {
  // Process “anchor-now” jobs serially
  new Worker(
    queueName,
    async (job) => {
      if (job.name !== 'anchor-now') return;
      const { credId } = job.data;

      const doc = await SignedVC.findById(credId).select('_id digest status anchoring').lean();
      if (!doc) throw new Error('VC not found');
      if (doc.status !== 'active') throw new Error('VC not active');
      // We allow either approved single or “now” mode
      const ok = (doc.anchoring?.state === 'queued' && (doc.anchoring?.approved_mode === 'single' || doc.anchoring?.queue_mode === 'now'));
      if (!ok) throw new Error('VC not queued for anchoring');

      const r = await commitBatch([doc], 'single');
      if (pub) pub.publish('events', JSON.stringify({ type: 'vc:anchored', credId, batchId: r.batch_id, ts: Date.now() }));
      return r;
    },
    { connection, concurrency: 1 }
  );
}

module.exports = { vcQueue, enqueueAnchorNow };
