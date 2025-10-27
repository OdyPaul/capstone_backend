// middleware/requestLogger.js
const { pub } = require('../lib/redis');
const { getAuthConn, getVcConn, getStudentsConn } = require('../config/db');
const AuditLogSchema = require('../models/common/auditLog.schema'); // <-- schema only

let AuditLogAuth = null;
let AuditLogVc = null;
let AuditLogStudents = null;

function getAuditModel(db) {
  try {
    if (db === 'auth') {
      if (!AuditLogAuth) {
        const conn = getAuthConn();
        if (!conn) return null;
        AuditLogAuth = conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
      }
      return AuditLogAuth;
    }
    if (db === 'students') {
      if (!AuditLogStudents) {
        const conn = getStudentsConn?.();
        if (!conn) return null;
        AuditLogStudents = conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
      }
      return AuditLogStudents;
    }
    // default: vc
    if (!AuditLogVc) {
      const conn = getVcConn();
      if (!conn) return null;
      AuditLogVc = conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
    }
    return AuditLogVc;
  } catch {
    return null; // fail-open: never break requests because of logging
  }
}

/** requestLogger(routeTag, { db: 'auth' | 'vc' | 'students' }) (default db = 'vc') */
module.exports = function requestLogger(routeTag = '', opts = {}) {
  const db = (opts && opts.db) || 'vc';

  return function (req, res, next) {
    const start = Date.now();

    res.on('finish', async () => {
      try {
        const AuditLog = getAuditModel(db);
        if (!AuditLog) return;

        const doc = {
          ts: new Date(),
          actorId:   req.user?._id || null,
          actorRole: req.user?.role || null,
          ip:        req.ip,
          ua:        req.headers['user-agent'] || '',
          method:    req.method,
          path:      (req.originalUrl || req.url || '').split('?')[0],
          status:    res.statusCode,
          latencyMs: Date.now() - start,
          routeTag,

          query:  req.query || {},
          params: req.params || {},
          bodyKeys: Object.keys(req.body || {}).filter(k =>
            !/password|token|otp|authorization|jwt|jws|salt/i.test(k)
          ),

          draftId:   req.params?.id || req.body?.draftId || null,
          paymentId: req.params?.id || req.body?.paymentId || req.params?.txNo || null,
          vcId:      req.body?.credId || req.params?.credId || null,

          meta: {},
        };

        // Helpful on login where req.user isn't set yet
        if (db === 'auth' && typeof req.body?.email === 'string') {
          doc.meta.loginEmail = String(req.body.email).toLowerCase();
        }

        await AuditLog.create(doc);

        if (pub) {
          pub.publish('events', JSON.stringify({
            type: 'audit',
            routeTag,
            path: doc.path,
            status: doc.status,
            actorRole: doc.actorRole,
            ts: doc.ts,
          }));
        }
      } catch {
        // swallow — logging must never affect the main request
      }
    });

    next();
  };
};
