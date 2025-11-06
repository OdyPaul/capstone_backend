// controllers/web/auditLogController.js
const { Types } = require('mongoose');
const AuditLogSchema = require('../../models/common/auditLog.schema');
const { getAuthConn, getVcConn, getStudentsConn } = require('../../config/db');

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
    if (!AuditLogVc) {
      const conn = getVcConn();
      if (!conn) return null;
      AuditLogVc = conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
    }
    return AuditLogVc;
  } catch {
    return null;
  }
}

const mapTypeToRegex = (type) => {
  switch ((type || '').toLowerCase()) {
    case 'login':  return /^auth\.login/i;
    case 'draft':  return /^vc\.draft/i;
    case 'issue':  return /^vc\.issue/i;
    case 'anchor': return /^vc\.anchor/i;
    default:       return null; // 'all'
  }
};

const buildFilter = ({ q, type, actorId, from, to }) => {
  const filter = {};
  const typeRx = mapTypeToRegex(type);
  if (typeRx) filter.routeTag = typeRx;

  if (actorId) {
    if (!Types.ObjectId.isValid(actorId)) {
      throw Object.assign(new Error('Invalid actorId'), { status: 400 });
    }
    filter.actorId = new Types.ObjectId(actorId);
  }

  if (from || to) {
    filter.ts = {};
    if (from) filter.ts.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to)   filter.ts.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  if (q && String(q).trim()) {
    const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const num = Number(q);
    const statusCond = Number.isFinite(num) ? [{ status: num }] : [];
    filter.$or = [
      { path: rx },
      { routeTag: rx },
      { ip: rx },
      { ua: rx },
      { method: rx },
      ...statusCond,
    ];
  }

  return filter;
};

const pullCapFor = (limit, page) => {
  const need = Math.max(1, limit) * Math.max(1, page);
  return Math.min(2000, need * 2);
};

async function findMany(model, filter, cap) {
  if (!model) return [];
  return model
    .find(filter)
    .sort({ ts: -1, _id: -1 })
    .limit(cap)
    .lean()
    .exec();
}

async function countMany(model, filter) {
  if (!model) return 0;
  return model.countDocuments(filter).exec();
}

/** GET /api/web/audit-logs */
async function listAuditLogs(req, res) {
  try {
    const {
      page: pageStr,
      limit: limitStr,
      q, type, actorId, from, to,
      source = 'all',
    } = req.query;

    const page  = Math.max(1, parseInt(pageStr || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(limitStr || '20', 10)));

    const filter = buildFilter({ q, type, actorId, from, to });
    const cap = pullCapFor(limit, page);

    const needAuth     = source === 'auth'     || source === 'all';
    const needVc       = source === 'vc'       || source === 'all';
    const needStudents = source === 'students' || source === 'all';

    const MAuth     = needAuth     ? getAuditModel('auth')     : null;
    const MVc       = needVc       ? getAuditModel('vc')       : null;
    const MStudents = needStudents ? getAuditModel('students') : null;

    const [authRows, vcRows, studentsRows] = await Promise.all([
      needAuth     ? findMany(MAuth, filter, cap)     : [],
      needVc       ? findMany(MVc,   filter, cap)     : [],
      needStudents ? findMany(MStudents, filter, cap) : [],
    ]);

    const merged = [...authRows, ...vcRows, ...studentsRows]
      .sort((a, b) => (new Date(b.ts) - new Date(a.ts)) || (String(b._id).localeCompare(String(a._id))));

    const [cAuth, cVc, cStu] = await Promise.all([
      needAuth     ? countMany(MAuth, filter)     : 0,
      needVc       ? countMany(MVc,   filter)     : 0,
      needStudents ? countMany(MStudents, filter) : 0,
    ]);
    const total = cAuth + cVc + cStu;

    const start = (page - 1) * limit;
    const items = merged.slice(start, start + limit);

    res.json({ items, total, page, pageSize: limit });
  } catch (e) {
    const code = e.status || 500;
    res.status(code).json({ message: e.message || 'Failed to load audit logs' });
  }
}

module.exports = { listAuditLogs };
