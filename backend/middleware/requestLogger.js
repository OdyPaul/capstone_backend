const { pub } = require('../lib/redis');
const { getAuthConn, getVcConn } = require('../config/db');
const AuditLogSchema = require('../models/common/auditLog.schema');

let AuditLogAuth = null;
let AuditLogVc = null;

function getAuditModel(db) {
  if (db === 'auth') {
    if (!AuditLogAuth) {
      const conn = getAuthConn();
      AuditLogAuth = conn.model('AuditLog', AuditLogSchema);
    }
    return AuditLogAuth;
  }
  // default: vc
  if (!AuditLogVc) {
    const conn = getVcConn();
    AuditLogVc = conn.model('AuditLog', AuditLogSchema);
  }
  return AuditLogVc;
}

/** requestLogger(routeTag, { db: 'auth' | 'vc' }) (default db = 'vc') */
module.exports = function requestLogger(routeTag = '', opts = {}) {
  const db = (opts && opts.db) || 'vc';

  return function (req, res, next) {
    const start = Date.now();

    res.on('finish', async () => {
      try {
        const AuditLog = getAuditModel(db);

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

        // (Optional) help triage logins without a user yet
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
      } catch (e) {
        // never break main flow
      }
    });

    next();
  };
};
