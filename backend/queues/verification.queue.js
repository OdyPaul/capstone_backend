// queues/verification.queue.js
const { Queue, Worker } = require('bullmq');
const { redis, pub } = require('../lib/redis');
const { getAuthConn, getStudentsConn } = require('../config/db');
const AuditLogSchema = require('../models/common/auditLog.schema');
const VerificationRequest = require('../models/mobile/verificationRequestModel');
const Image = require('../models/mobile/imageModel');
const User = require('../models/common/userModel');
const Student = require('../models/students/studentModel');

const connection = redis || (process.env.REDIS_URL ? { url: process.env.REDIS_URL } : null);
const queueName = 'verification-requests';
const verificationQueue = connection ? new Queue(queueName, { connection }) : null;

// ===== Audit helper (same model wiring pattern as requestLogger) =====
let AuditLogAuth = null;
function getAuditModelAuth() {
  try {
    if (!AuditLogAuth) {
      const conn = getAuthConn();
      if (!conn) return null;
      AuditLogAuth = conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
    }
    return AuditLogAuth;
  } catch {
    return null;
  }
}
async function writeAudit({ routeTag, status = 200, meta = {}, actorId = null, actorRole = null }) {
  try {
    const AuditLog = getAuditModelAuth();
    if (!AuditLog) return;
    await AuditLog.create({
      ts: new Date(),
      actorId, actorRole,
      ip: null, ua: '',
      method: 'QUEUE', path: `/queue/${routeTag}`,
      status, latencyMs: 0, routeTag,
      query: {}, params: {}, bodyKeys: [],
      draftId: null, paymentId: null, vcId: null,
      meta,
    });
  } catch { /* swallow */ }
}

// ===== Enqueue API =====
async function enqueueVerify({ requestId, studentId = null, actorId = null, actorRole = null }) {
  if (!verificationQueue) return;
  await verificationQueue.add(
    'verify',
    { requestId, studentId, actorId, actorRole },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 500,
      removeOnFail: 100,
    }
  );
}

async function enqueueReject({ requestId, reason = '', actorId = null, actorRole = null }) {
  if (!verificationQueue) return;
  await verificationQueue.add(
    'reject',
    { requestId, reason: String(reason || '').slice(0, 240), actorId, actorRole },
    {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 500,
      removeOnFail: 100,
    }
  );
}

// ===== Worker =====
if (connection) {
  new Worker(
    queueName,
    async (job) => {
      if (job.name === 'verify') {
        const { requestId, studentId, actorId, actorRole } = job.data;

        const vr = await VerificationRequest.findById(requestId).lean();
        if (!vr) throw new Error('VerificationRequest not found');
        if (vr.status !== 'pending') throw new Error(`Request not pending (is ${vr.status})`);

        // Optional: link to student profile (userId unique+sparse on Student)
        if (studentId) {
          const s = await Student.findById(studentId);
          if (!s) throw new Error('Student not found');
          if (s.userId && String(s.userId) !== String(vr.user)) {
            throw new Error('Student already linked to a different user');
          }
          s.userId = vr.user;
          await s.save();
        }

        // Mark user verified
        await User.findByIdAndUpdate(vr.user, { verified: 'verified' });

        // Update request
        await VerificationRequest.findByIdAndUpdate(requestId, {
          status: 'verified',
          verifiedAt: new Date(),
        });

        // Expire images in 30 days
        const expireDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const upds = [];
        if (vr.selfieImage) upds.push(Image.findByIdAndUpdate(vr.selfieImage, { expiresAt: expireDate }));
        if (vr.idImage) upds.push(Image.findByIdAndUpdate(vr.idImage, { expiresAt: expireDate }));
        await Promise.all(upds);

        await writeAudit({
          routeTag: 'mobile.verify.queue.verify',
          meta: { requestId, studentId },
          actorId, actorRole,
        });

        if (pub) {
          pub.publish('events', JSON.stringify({
            type: 'verification:verified',
            requestId, studentId,
            by: actorRole, ts: Date.now(),
          }));
        }
        return { ok: true };
      }

      if (job.name === 'reject') {
        const { requestId, reason, actorId, actorRole } = job.data;

        const vr = await VerificationRequest.findById(requestId);
        if (!vr) throw new Error('VerificationRequest not found');
        if (vr.status !== 'pending') throw new Error(`Request not pending (is ${vr.status})`);

        vr.status = 'rejected';
        vr.verifiedAt = null;
        await vr.save();

        await writeAudit({
          routeTag: 'mobile.verify.queue.reject',
          meta: { requestId, reason },
          actorId, actorRole,
        });

        if (pub) {
          pub.publish('events', JSON.stringify({
            type: 'verification:rejected',
            requestId,
            reason,
            by: actorRole, ts: Date.now(),
          }));
        }
        return { ok: true };
      }
    },
    { connection, concurrency: 3 }
  );
}

module.exports = { verificationQueue, enqueueVerify, enqueueReject };
