// middleware/requestLogger.js
const AuditLog = require('../models/common/auditLog');
const { pub } = require('../lib/redis');

module.exports = function requestLogger(routeTag = '') {
  return function (req, res, next) {
    const start = Date.now();
    res.on('finish', async () => {
      try {
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

          // Optional quick-filters if present
          draftId:   req.params?.id || req.body?.draftId || null,
          paymentId: req.params?.id || req.body?.paymentId || req.params?.txNo || null,
          vcId:      req.body?.credId || req.params?.credId || null,

          meta: {},
        };

        await AuditLog.create(doc);

        // Optional live “audit” ping
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
        // console.error('AuditLog error:', e.message);
      }
    });
    next();
  };
};
