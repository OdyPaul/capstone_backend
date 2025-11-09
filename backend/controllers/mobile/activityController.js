// controllers/mobile/activityController.js
const { getAuthConn } = require('../../config/db');
const AuditLogSchema = require('../../models/common/auditLog.schema');

function getAuditModel() {
  const conn = getAuthConn();
  if (!conn) return null;
  return conn.models.AuditLog || conn.model('AuditLog', AuditLogSchema);
}

function mapAuditToItem(doc) {
  const meta = doc.meta || {};
  const id = `audit-${doc._id.toString()}`;
  const ts = new Date(doc.ts).getTime();

  // Default mapping
  let type = meta.event || 'activity';
  let title = meta.title || 'Activity';
  let desc = meta.body || '';
  let status = meta.status || '';
  let icon = 'notifications-outline';
  let extra = meta;

  switch (meta.event) {
    case 'vc.claimed':
      type = 'vc_claimed';
      title = 'Credential claimed';
      icon = 'download-outline';
      status = 'ok';
      break;
    case 'vc.anchored':
      type = 'vc_anchored';
      title = 'Credential anchored on-chain';
      icon = 'link-outline';
      status = 'anchored';
      break;
    case 'session.presented':
      type = 'session_present';
      title = meta.valid ? 'VC presented (valid)' : 'VC presented (not valid)';
      icon = 'qr-code-outline';
      status = meta.reason || (meta.valid ? 'ok' : 'failed');
      if (!desc && meta.reason) desc = `Result: ${meta.reason}`;
      break;
    case 'session.denied':
      type = 'session_present';
      title = 'Presentation denied';
      icon = 'close-circle-outline';
      status = 'denied_by_holder';
      break;
    case 'session.expired':
      type = 'session_present';
      title = 'Presentation expired';
      icon = 'time-outline';
      status = 'expired_session';
      break;
    default:
      break;
  }

  return {
    id, ts, type, title, desc, status, icon, meta: extra,
  };
}

exports.listMine = async function listMine(req, res) {
  try {
    const AuditLog = getAuditModel();
    if (!AuditLog) return res.status(503).json({ message: 'Audit store unavailable' });

    const userId = req.user?._id?.toString();
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const limit = Math.min(Number(req.query.limit || 200), 500);

    // Only items intended for this user. We also scope to our routeTag for safety.
    const rows = await AuditLog.find({
      routeTag: 'vc.activity',
      $or: [
        { 'meta.recipients': userId },
        { actorId: userId }, // fallback: user themselves
      ],
    })
      .sort({ ts: -1 })
      .limit(limit)
      .lean();

    const items = rows.map(mapAuditToItem);
    return res.json(items);
  } catch (e) {
    return res.status(500).json({ message: e.message || 'activity fetch failed' });
  }
};
