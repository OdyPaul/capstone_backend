// controllers/mobile/claimQueueController.js
const mongoose = require('mongoose');
const { redis } = require('../../lib/redis');
const ClaimTicket = require('../../models/web/claimTicket');
const SignedVC = require('../../models/web/signedVcModel');

/* 🔔 Minimal audit (auth DB) */
const { getAuthConn } = require('../../config/db');
const AuditLogSchema = require('../../models/common/auditLog.schema');
let AuditLogAuth = null;
function getAuditLogAuth() {
  try {
    if (!AuditLogAuth) {
      const conn = getAuthConn && getAuthConn();
      if (!conn) return null;
      AuditLogAuth = conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
    }
    return AuditLogAuth;
  } catch { return null; }
}
async function emitVCAudit({
  actorId, actorRole, event, recipients = [],
  targetId, title, body, extra = {}, dedupeKey
}) {
  try {
    const AuditLog = getAuditLogAuth();
    if (!AuditLog) return;

    if (dedupeKey) {
      const exists = await AuditLog.exists({ 'meta.dedupeKey': dedupeKey });
      if (exists) return;
    }

    await AuditLog.create({
      ts: new Date(),
      actorId: actorId || null,
      actorRole: actorRole || null,
      ip: null,
      ua: '',
      method: 'INTERNAL',
      path: '/mobile/claim-queue',
      status: 200,
      latencyMs: 0,
      routeTag: 'vc.activity',
      query: {},
      params: {},
      bodyKeys: [],
      draftId: null,
      paymentId: null,
      vcId: targetId || null,
      meta: {
        event,
        recipients,
        targetKind: 'vc',
        targetId: targetId || null,
        title: title || null,
        body: body || null,
        dedupeKey: dedupeKey || undefined,
        ...extra,
      },
    });
  } catch { /* best-effort */ }
}

const DEFAULT_QUEUE_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

// ---- Helpers ----
function keyUserSet(userId) {
  return `cq:u:${userId}`;
}
function keyTokenHash(token) {
  return `cq:t:${token}`;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function toSec(ms) {
  return Math.ceil(ms / 1000);
}
function safeISO(d) {
  try { return new Date(d).toISOString(); } catch { return null; }
}
function buildVcPayload(vc) {
  return {
    format: 'vc+jws',
    jws: vc.jws,
    kid: vc.kid,
    alg: vc.alg,
    salt: vc.salt,
    digest: vc.digest,
    anchoring: vc.anchoring,
  };
}

// ------------------ Core redeem (same as GET /c/:token), with holder bind + claimed_at ------------------
async function redeemTokenForUser(token, holderUserId) {
  const now = new Date();

  const ticket = await ClaimTicket.findOne({ token });
  if (!ticket) { const err = new Error('Claim token not found'); err.status = 404; throw err; }
  if (ticket.expires_at && ticket.expires_at < now) { const err = new Error('Claim token expired'); err.status = 410; throw err; }

  // fetch minimal VC fields used below (+ meta in case you want to show more client-side)
  const vc = await SignedVC.findById(ticket.cred_id)
    .select('_id jws alg kid digest salt anchoring status holder_user_id claimed_at meta');
  if (!vc) { const err = new Error('Credential not found'); err.status = 404; throw err; }
  if (vc.status !== 'active') { const err = new Error('Credential not active'); err.status = 409; throw err; }

  // 1) Mark ticket consumed (idempotent)
  if (!ticket.used_at) {
    ticket.used_at = now;
    await ticket.save().catch(() => {});
  }

  // 2) Try to atomically set both holder_user_id (first come wins) and claimed_at (first claim wins)
  try {
    const canBind = holderUserId && mongoose.Types.ObjectId.isValid(holderUserId);

    if (canBind) {
      // attempt to set BOTH fields in a single atomic update, only if both are still empty
      const res = await SignedVC.updateOne(
        {
          _id: vc._id,
          $and: [
            { $or: [{ holder_user_id: { $exists: false } }, { holder_user_id: null }] },
            { $or: [{ claimed_at: { $exists: false } }, { claimed_at: null }] },
          ],
        },
        { $set: { holder_user_id: holderUserId, claimed_at: now } }
      );

      if (!res.modifiedCount) {
        // ensure claimed_at is set at least once, without touching holder_user_id
        await SignedVC.updateOne(
          { _id: vc._id, $or: [{ claimed_at: { $exists: false } }, { claimed_at: null }] },
          { $set: { claimed_at: now } }
        );
      }
    } else {
      // no user id: still set claimed_at first time
      await SignedVC.updateOne(
        { _id: vc._id, $or: [{ claimed_at: { $exists: false } }, { claimed_at: null }] },
        { $set: { claimed_at: now } }
      );
    }
  } catch { /* never block redeem on marking */ }

  // 🔔 Emit Activity: vc.claimed (recipient: holder)
  try {
    if (holderUserId) {
      await emitVCAudit({
        actorId: holderUserId,
        actorRole: null,
        event: 'vc.claimed',
        recipients: [String(holderUserId)],
        targetId: String(vc._id),
        title: 'Credential claimed',
        body: 'Your credential was added to your wallet.',
        extra: { digest: vc.digest || null, kid: vc.kid || null },
        dedupeKey: `vc.claimed:${vc._id}`, // idempotent per VC
      });
    }
  } catch { /* best-effort */ }

  // enriched payload for mobile
  const payload = buildVcPayload(vc);
  payload.ticket_id = ticket._id;
  payload.user_id = holderUserId || null;
  payload.claimed_at = new Date().toISOString();
  payload.meta = vc.meta || null;

  return payload;
}

// ------------------ Redis I/O ------------------
async function addToQueue({ userId, token, url, expiresAt }) {
  if (!redis) throw new Error('Redis not available');
  const userKey = keyUserSet(userId);
  const tokKey = keyTokenHash(token);
  const nowIso = new Date().toISOString();

  const payload = {
    token,
    url,
    userId,
    savedAt: nowIso,
    expiresAt: expiresAt ? safeISO(expiresAt) : null,
  };

  const multi = redis.multi();
  multi.hset(tokKey, payload);
  if (payload.expiresAt) {
    const ttl = toSec(new Date(payload.expiresAt).getTime() - Date.now());
    multi.expire(tokKey, clamp(ttl, 60, DEFAULT_QUEUE_TTL_SEC));
  } else {
    multi.expire(tokKey, DEFAULT_QUEUE_TTL_SEC);
  }

  multi.sadd(userKey, token);
  await multi.exec();
}

async function getQueueTokens(userId) {
  if (!redis) throw new Error('Redis not available');
  const userKey = keyUserSet(userId);
  const tokens = await redis.smembers(userKey);
  if (!tokens || tokens.length === 0) return [];

  const multi = redis.multi();
  tokens.forEach(t => multi.hgetall(keyTokenHash(t)));
  const rows = await multi.exec();

  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const row = rows[i] && rows[i][1];
    if (row && row.token) {
      out.push({
        token: row.token,
        url: row.url,
        userId: row.userId,
        savedAt: row.savedAt,
        expiresAt: row.expiresAt,
      });
    } else {
      // stale member; remove from set
      await redis.srem(userKey, tokens[i]).catch(() => {});
    }
  }
  return out;
}

async function removeFromQueue(userId, token) {
  if (!redis) throw new Error('Redis not available');
  const userKey = keyUserSet(userId);
  const tokKey = keyTokenHash(token);
  const multi = redis.multi();
  multi.srem(userKey, token);
  multi.del(tokKey);
  await multi.exec();
}

// ------------------ HTTP Handlers ------------------

// POST /api/mobile/claim-queue/enqueue
// body: { token, url, expires_at? }
exports.enqueue = async function enqueue(req, res) {
  try {
    if (!redis) return res.status(503).json({ message: 'Queue unavailable' });
    const userId = req.user?._id?.toString();
    const { token, url, expires_at } = req.body || {};
    if (!token || !url) return res.status(400).json({ message: 'token and url required' });

    await addToQueue({ userId, token, url, expiresAt: expires_at || null });
    return res.status(201).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: e.message || 'enqueue failed' });
  }
};

// POST /api/mobile/claim-queue/enqueue-batch
// body: { items: [{ token, url, expires_at? }, ...] }
exports.enqueueBatch = async function enqueueBatch(req, res) {
  try {
    if (!redis) return res.status(503).json({ message: 'Queue unavailable' });
    const userId = req.user?._id?.toString();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: 'items required' });

    let success = 0;
    for (const it of items) {
      if (it && it.token && it.url) {
        await addToQueue({ userId, token: it.token, url: it.url, expiresAt: it.expires_at || null });
        success++;
      }
    }
    return res.status(201).json({ ok: true, count: success });
  } catch (e) {
    return res.status(500).json({ message: e.message || 'enqueue-batch failed' });
  }
};

// GET /api/mobile/claim-queue
exports.list = async function list(req, res) {
  try {
    if (!redis) return res.status(503).json({ message: 'Queue unavailable' });
    const userId = req.user?._id?.toString();
    const rows = await getQueueTokens(userId);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ message: e.message || 'list failed' });
  }
};

// POST /api/mobile/claim-queue/redeem-one
// body: { token }
exports.redeemOne = async function redeemOne(req, res) {
  const userId = req.user?._id?.toString(); // keep outside try so catch can use it
  try {
    if (!redis) return res.status(503).json({ message: 'Queue unavailable' });
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ message: 'token required' });

    const payload = await redeemTokenForUser(token, userId);
    await removeFromQueue(userId, token);
    return res.json({ ok: true, message: 'Credential claimed successfully', payload });
  } catch (e) {
    const status = e.status || 500;
    if (status === 404 || status === 410) {
      try { await removeFromQueue(userId, req.body?.token); } catch {}
    }
    return res.status(status).json({ ok: false, message: e.message || 'redeem failed' });
  }
};

// POST /api/mobile/claim-queue/redeem-all
// Redeems everything in the user’s queue; returns per-token results.
exports.redeemAll = async function redeemAll(req, res) {
  try {
    if (!redis) return res.status(503).json({ message: 'Queue unavailable' });
    const userId = req.user?._id?.toString();
    const rows = await getQueueTokens(userId);
    const results = [];

    for (const row of rows) {
      try {
        const payload = await redeemTokenForUser(row.token, userId);
        await removeFromQueue(userId, row.token);
        results.push({ token: row.token, ok: true, payload });
      } catch (e) {
        results.push({ token: row.token, ok: false, message: e.message || 'redeem failed' });
      }
    }

    return res.json({
      ok: true,
      count: results.length,
      results,
      summary: {
        success: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
      },
    });
  } catch (e) {
    return res.status(500).json({ message: e.message || 'redeem-all failed' });
  }
};
