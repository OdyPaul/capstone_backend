// queues/verification.queue.js
const { Queue, Worker } = require('bullmq');
const { redis, pub } = require('../lib/redis');
const VerificationRequest = require('../models/mobile/verificationRequestModel');
const User = require('../models/common/userModel');
const Student = require('../models/students/studentModel');
const Image = require('../models/mobile/imageModel');

const connection = redis || (process.env.REDIS_URL ? { url: process.env.REDIS_URL } : null);
const queueName = 'verification';
const vrQueue = connection ? new Queue(queueName, { connection }) : null;

async function enqueueVerify(payload) {
  if (!vrQueue) return;
  await vrQueue.add('verify', payload, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
}
async function enqueueReject(payload) {
  if (!vrQueue) return;
  await vrQueue.add('reject', payload, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
}

async function handleVerify({ requestId, studentId, actorId, actorRole }) {
  const req = await VerificationRequest.findById(requestId);
  if (!req) throw new Error('VerificationRequest not found');
  if (req.status !== 'pending') return { skipped: true, status: req.status };

  let student = null;
  if (studentId) {
    student = await Student.findById(studentId);
    if (!student) throw new Error('Student not found');
    if (student.userId && String(student.userId) !== String(req.user))
      throw new Error('Student already linked to a different user');
    if (!student.userId) {
      student.userId = req.user;
      await student.save();
    }
    req.student = student._id;
  }

  // Mark request verified
  req.status = 'verified';
  req.verifiedAt = new Date();
  req.reviewedAt = new Date();
  req.reviewedBy = actorId || null;
  req.rejectionReason = null;
  await req.save();

  // Update user (→ verified + link student)
  const update = { verified: 'verified' };
  if (req.student) update.studentId = req.student;
  await User.findByIdAndUpdate(req.user, { $set: update });

  // Expire images in 30 days
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const updates = [];
  if (req.selfieImage) updates.push(Image.findByIdAndUpdate(req.selfieImage, { expiresAt }));
  if (req.idImage) updates.push(Image.findByIdAndUpdate(req.idImage, { expiresAt }));
  await Promise.all(updates);

  if (pub) {
    pub.publish('events', JSON.stringify({
      type: 'verification:verified',
      requestId, studentId: req.student || null, actorId, actorRole, ts: Date.now()
    }));
  }
  return { ok: true, requestId, studentId: req.student || null };
}

async function handleReject({ requestId, reason, actorId, actorRole }) {
  const req = await VerificationRequest.findById(requestId);
  if (!req) throw new Error('VerificationRequest not found');
  if (req.status !== 'pending') return { skipped: true, status: req.status };

  req.status = 'rejected';
  req.reviewedAt = new Date();
  req.reviewedBy = actorId || null;
  req.rejectionReason = String(reason || 'Rejected by administrator').slice(0, 240);
  req.verifiedAt = null;
  await req.save();

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const updates = [];
  if (req.selfieImage) updates.push(Image.findByIdAndUpdate(req.selfieImage, { expiresAt }));
  if (req.idImage) updates.push(Image.findByIdAndUpdate(req.idImage, { expiresAt }));
  await Promise.all(updates);

  if (pub) {
    pub.publish('events', JSON.stringify({
      type: 'verification:rejected',
      requestId, actorId, actorRole, ts: Date.now()
    }));
  }
  return { ok: true, requestId };
}

// Worker
if (connection) {
  new Worker(
    queueName,
    async (job) => {
      if (job.name === 'verify') return handleVerify(job.data);
      if (job.name === 'reject') return handleReject(job.data);
    },
    { connection, concurrency: 2 }
  );
}

module.exports = { vrQueue, enqueueVerify, enqueueReject };
