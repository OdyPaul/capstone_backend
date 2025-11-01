// controllers/web/claimController.js
// Claim ticket CRUD + static QR + public redeem (no animated UR).
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const QRCode = require('qrcode');

const ClaimTicket = require('../../models/web/claimTicket');
const SignedVC = require('../../models/web/signedVcModel');
const { randomToken } = require('../../utils/tokens');

// ---------- tunables ----------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const DEFAULT_QR_SIZE = Number(process.env.QR_DEFAULT_SIZE || 360);
const MIN_QR_SIZE = 160;
const MAX_QR_SIZE = 560;

function baseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ---------- helpers ----------
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

async function loadTicketByIdOr404(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { error: { code: 400, msg: 'Invalid claim id' } };
  }
  const ticket = await ClaimTicket.findById(id).lean();
  return ticket ? { ticket } : { error: { code: 404, msg: 'Claim not found' } };
}

async function loadTicketByTokenOr404(token) {
  const ticket = await ClaimTicket.findOne({ token }).lean();
  return ticket ? { ticket } : { error: { code: 404, msg: 'Claim token not found' } };
}

async function loadVcForTicketOr404(ticket) {
  const vc = await SignedVC.findById(ticket.cred_id)
    .select('jws alg kid digest salt anchoring status')
    .lean();
  if (!vc) return { error: { code: 404, msg: 'Credential not found' } };
  if (!vc.jws) return { error: { code: 409, msg: 'VC has no JWS payload' } };
  if (vc.status && vc.status !== 'active') {
    return { error: { code: 409, msg: 'Credential not active' } };
  }
  return { vc };
}

// ---------- PUBLIC (token-based) ----------
exports.redeemClaim = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const now = new Date();

  const ticket = await ClaimTicket.findOne({ token });
  if (!ticket) return res.status(404).json({ message: 'Claim token not found' });
  if (ticket.expires_at && ticket.expires_at < now) {
    return res.status(410).json({ message: 'Claim token expired' });
  }

  const vc = await SignedVC.findById(ticket.cred_id)
    .select('_id jws alg kid digest salt anchoring status claimed_at');
  if (!vc) return res.status(404).json({ message: 'Credential not found' });
  if (vc.status !== 'active') return res.status(409).json({ message: 'Credential not active' });

  // consume the ticket once
  if (!ticket.used_at) {
    ticket.used_at = now;
    await ticket.save().catch(() => {});
  }

  // mark first-claim moment (no holder bind here)
  try {
    await SignedVC.updateOne(
      { _id: vc._id, $or: [{ claimed_at: { $exists: false } }, { claimed_at: null }] },
      { $set: { claimed_at: now } }
    );
  } catch {}

  res.set('Cache-Control', 'no-store');
  res.json(buildVcPayload(vc));
});


// ---------- ADMIN (id-based, protected) ----------
exports.createClaim = asyncHandler(async (req, res) => {
  const { credId, ttlDays = 7, singleActive = true } = req.body;
  const vc = await SignedVC.findById(credId).select('_id status claimed_at');
  if (!vc) return res.status(404).json({ message: 'Credential not found' });
  if (vc.status !== 'active') return res.status(409).json({ message: 'VC not active' });
  if (vc.claimed_at) return res.status(409).json({ message: 'VC already claimed' });
  const now = new Date();
  if (singleActive) {
    const existing = await ClaimTicket.findOne({
      cred_id: vc._id,
      expires_at: { $gt: now },
    }).sort({ createdAt: -1 });

    if (existing) {
      const base = baseUrl(req);
      return res.status(200).json({
        claim_id: existing._id.toString(),
        token: existing.token,
        claim_url: `${base}/c/${existing.token}`,
        expires_at: existing.expires_at,
        reused: true,
      });
    }
  }

  const token = randomToken();
  const expires_at = new Date(now.getTime() + Number(ttlDays) * 864e5);

  const created = await ClaimTicket.create({
    token,
    cred_id: vc._id,
    expires_at,
    created_by: req.user?._id || null,
  });

  const base = baseUrl(req);
  res.status(201).json({
    claim_id: created._id.toString(),
    token,
    claim_url: `${base}/c/${token}`,
    expires_at,
    reused: false,
  });
});

exports.listClaims = asyncHandler(async (req, res) => {
  const { status, credId, q } = req.query;
  const now = new Date();

  const filter = {};
  if (credId) filter.cred_id = credId;

  let tickets = await ClaimTicket.find(filter)
    .populate({ path: 'cred_id', model: SignedVC, select: 'template_id student_id vc_payload createdAt' })
    .sort({ createdAt: -1 })
    .lean();

  const base = baseUrl(req);

  let rows = tickets.map((t) => {
    const vc = t.cred_id || {};
    const subj = vc.vc_payload?.credentialSubject || {};
    const computedStatus = t.expires_at < now ? 'expired' : (t.used_at ? 'used' : 'active');
    return {
      _id: t._id,
      token: t.token,
      claim_url: `${base}/c/${t.token}`,
      expires_at: t.expires_at,
      used_at: t.used_at,
      created_at: t.createdAt,
      status: computedStatus,
      credential: {
        id: vc._id,
        template_id: vc.template_id,
        student_id: vc.student_id,
        subjectName: subj.fullName,
        studentNumber: subj.studentNumber,
      },
    };
  });

  if (status && ['active', 'used', 'expired'].includes(status)) {
    rows = rows.filter((r) => r.status === status);
  }
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.token || '').toLowerCase().includes(needle) ||
        (r.credential?.subjectName || '').toLowerCase().includes(needle) ||
        (r.credential?.studentNumber || '').toLowerCase().includes(needle) ||
        (r.credential?.template_id || '').toLowerCase().includes(needle)
    );
  }

  res.json(rows);
});

exports.getClaim = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid claim id' });
  }

  const t = await ClaimTicket.findById(req.params.id)
    .populate({ path: 'cred_id', model: SignedVC, select: 'template_id student_id vc_payload createdAt' });

  if (!t) return res.status(404).json({ message: 'Claim not found' });

  const base = baseUrl(req);
  const now = new Date();
  const computedStatus = t.expires_at < now ? 'expired' : (t.used_at ? 'used' : 'active');
  const subj = t.cred_id?.vc_payload?.credentialSubject || {};

  res.json({
    _id: t._id,
    token: t.token,
    claim_url: `${base}/c/${t.token}`,
    expires_at: t.expires_at,
    used_at: t.used_at,
    created_at: t.createdAt,
    status: computedStatus,
    credential: {
      id: t.cred_id?._id,
      template_id: t.cred_id?.template_id,
      student_id: t.cred_id?.student_id,
      subjectName: subj.fullName,
      studentNumber: subj.studentNumber,
    },
  });
});

exports.qrPng = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid claim id' });
  }
  const t = await ClaimTicket.findById(req.params.id).lean();
  if (!t) return res.status(404).json({ message: 'Claim not found' });

  const base = baseUrl(req);
  const claimUrl = `${base}/c/${t.token}`;

  const size = clamp(Number(req.query.size) || DEFAULT_QR_SIZE, MIN_QR_SIZE, MAX_QR_SIZE);
  const buf = await QRCode.toBuffer(claimUrl, { width: size, margin: 2 });

  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.send(buf);
});
