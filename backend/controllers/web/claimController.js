// controllers/web/claimController.js
// Offline UR QR for VC delivery + claim ticket CRUD.
//
// ✓ Smaller default UR part size for easier scanning
// ✓ Proper quiet zone & low ECL (more capacity per symbol)
// ✓ Deterministic per-index frames (no encoder.isComplete())
// ✓ ?txt=1 returns raw "ur:bytes/..." for debugging
// ✓ ?seq=of forces legacy "2of14" sequence style for older scanners
// ✓ Admin (id) and Public (token) endpoints

const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const cbor = require('cbor');
const { deflateRawSync } = require('zlib');
const BCUR = require('@ngraveio/bc-ur'); // use one import; feature-detect below
const QRCode = require('qrcode');

const ClaimTicket = require('../../models/web/claimTicket');
const SignedVC = require('../../models/web/signedVcModel');
const { randomToken } = require('../../utils/tokens');

// ---------- tunables (override via env) ----------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const DEFAULT_PART_BYTES = Number(process.env.QR_PART_BYTES || 220); // good range: 120..300
const MIN_PART_BYTES = 120;
const MAX_PART_BYTES = Number(process.env.QR_MAX_PART_BYTES || 1200);

const DEFAULT_QR_SIZE = Number(process.env.QR_DEFAULT_SIZE || 360);
const MIN_QR_SIZE = 160;
const MAX_QR_SIZE = 560;

const QR_MARGIN = Number(process.env.QR_MARGIN ?? 4); // quiet zone modules
const QR_ECL = String(process.env.QR_ECL || 'L').toUpperCase(); // L|M|Q|H

// Prefer new Fountain classes; gracefully fall back to older names
const HasFountainEncoder = !!BCUR.UrFountainEncoder;
const URClass = BCUR.UR;

// For HTML pages that need absolute links (some hosts proxy / origin)
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

/**
 * Deterministic per-index UR frame generation.
 * - Deflate (raw) the CBOR payload → bytes
 * - Estimate frame count from deflated size and partBytes
 * - Generate part string for index i
 *   * New API (UrFountainEncoder): consume i frames → nextPartUr().toString()
 *   * Old API (UREncoder): seed first sequence number = i+1 → nextPart()
 * - Optional seq style: "2-14" (default) or force "2of14" via seqStyle='of'
 */
function prepareUrMeta(vc, partBytesOverride, seqStyle = 'dash') {
  const payload = buildVcPayload(vc);
  const cborBytes = cbor.encode(payload);
  const deflated = deflateRawSync(cborBytes);

  const partBytes = clamp(
    Number(partBytesOverride) || DEFAULT_PART_BYTES,
    MIN_PART_BYTES,
    MAX_PART_BYTES
  );

  const ur = URClass.fromBuffer(deflated); // type "bytes"

  // Rough estimate for UI only (fountain overhead ~15% + a few extra)
  const framesCount = Math.max(
    1,
    Math.ceil((deflated.length / Math.max(1, partBytes - 8)) * 1.15) + 3
  );

  function normalizeSequenceStyle(s) {
    if (seqStyle !== 'of') return s;
    // Convert "ur:TYPE/<a>-<b>/" → "ur:TYPE/<a>of<b>/"
    return s.replace(
      /^(ur:[a-z0-9-]+\/)(\d+)-(\d+)(\/)/i,
      (_m, pfx, a, b, slash) => `${pfx}${a}of${b}${slash}`
    );
  }

  function frameStringAt(i /* 0-based */) {
    // New fountain API (preferred)
    if (HasFountainEncoder) {
      const enc = new BCUR.UrFountainEncoder(ur, partBytes);
      // deterministically advance to the i-th frame
      for (let k = 0; k < i; k++) enc.nextPartUr();
      const partUr = enc.nextPartUr(); // UR object
      return normalizeSequenceStyle(partUr.toString());
    }

    // Legacy encoder API
    if (BCUR.UREncoder) {
      const enc = new BCUR.UREncoder(ur, partBytes, Math.max(1, Number(i) + 1));
      const s = enc.nextPart(); // already a string
      // enc.nextPart() may already be "of" style; normalize only if asked
      return seqStyle === 'of' ? s.replace(/(\d+)-(\d+)/, '$1of$2') : s;
    }

    throw new Error('No compatible UR encoder found in @ngraveio/bc-ur');
  }

  return { framesCount, frameStringAt };
}

// ---------- ADMIN (id-based, protected) ----------
exports.qrEmbedFrames = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { ticket, error } = await loadTicketByIdOr404(id);
  if (error) return res.status(error.code).json({ message: error.msg });

  const vcRes = await loadVcForTicketOr404(ticket);
  if (vcRes.error) return res.status(vcRes.error.code).json({ message: vcRes.error.msg });

  const seqStyle = (req.query.seq === 'of') ? 'of' : 'dash';
  const meta = prepareUrMeta(vcRes.vc, req.query.part, seqStyle);
  res.json({ scheme: 'ur', framesCount: meta.framesCount });
});

exports.qrEmbedFramePng = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { ticket, error } = await loadTicketByIdOr404(id);
  if (error) return res.status(error.code).json({ message: error.msg });

  const vcRes = await loadVcForTicketOr404(ticket);
  if (vcRes.error) return res.status(vcRes.error.code).json({ message: vcRes.error.msg });

  const i = Math.max(0, Number(req.query.i) || 0);
  const size = clamp(Number(req.query.size) || DEFAULT_QR_SIZE, MIN_QR_SIZE, MAX_QR_SIZE);
  const seqStyle = (req.query.seq === 'of') ? 'of' : 'dash';

  const meta = prepareUrMeta(vcRes.vc, req.query.part, seqStyle);
  const urPart = meta.frameStringAt(i);

  // text mode for debugging
  if (String(req.query.txt) === '1') {
    res.set('Cache-Control', 'no-store');
    return res.type('text/plain').send(urPart);
  }

  const buf = await QRCode.toBuffer(urPart, {
    width: size,
    margin: QR_MARGIN,
    errorCorrectionLevel: QR_ECL,
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.send(buf);
});

exports.qrEmbedPage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const size = clamp(Number(req.query.size) || DEFAULT_QR_SIZE, MIN_QR_SIZE, MAX_QR_SIZE);
  const fps = clamp(Number(req.query.fps) || 2, 1, 8);
  const intervalMs = Math.round(1000 / fps);
  const seq = req.query.seq === 'of' ? '&seq=of' : '';
  const part = req.query.part ? `&part=${encodeURIComponent(req.query.part)}` : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Offline VC QR</title>
<style>
  body { font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:#0b1020; color:#eee; margin:0; display:grid; place-items:center; height:100vh; }
  .wrap { display:flex; gap:24px; align-items:center; flex-direction:column; }
  .card { background:#121836; border-radius:16px; padding:18px 18px 8px 18px; box-shadow: 0 8px 20px rgba(0,0,0,.5); }
  img { width:${size}px; height:${size}px; image-rendering:pixelated; background:#fff; }
  .muted { opacity:.7; font-size:12px; }
  .row { display:flex; gap:14px; align-items:center; }
  code { background:#0f142b; padding:4px 8px; border-radius:6px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card"><img id="qr" alt="QR frame"/></div>
    <div class="row">
      <div>Frame: <code id="pos">—</code>/<code id="len">—</code></div>
      <div class="muted">FPS: ${fps}</div>
    </div>
    <div class="muted">Keep the phone steady; the wallet will reconstruct offline.</div>
  </div>
  <script>
    const id = ${JSON.stringify(id)};
    const size = ${size};
    const intervalMs = ${intervalMs};
    const qs = ${JSON.stringify(seq + part)};
    let N = 0, i = 0;

    async function start() {
      const r = await fetch('/api/web/claims/'+id+'/qr-embed/frames' + qs);
      const j = await r.json();
      if (!r.ok) { alert('Failed: '+(j.message||r.status)); return; }
      N = j.framesCount || 50; // UI only
      document.getElementById('len').textContent = N;
      setInterval(tick, intervalMs);
      tick();
    }
    async function tick() {
      document.getElementById('pos').textContent = ((i % N) + 1);
      const img = document.getElementById('qr');
      img.src = '/api/web/claims/'+id+'/qr-embed/frame?i='+i+'&size='+size + qs + '&_t=' + Date.now();
      i++;
    }
    start();
  </script>
</body>
</html>`;
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.type('html').send(html);
});

// ---------- PUBLIC (token-based, no auth) ----------
exports.qrEmbedFramesByToken = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { ticket, error } = await loadTicketByTokenOr404(token);
  if (error) return res.status(error.code).json({ message: error.msg });

  const vcRes = await loadVcForTicketOr404(ticket);
  if (vcRes.error) return res.status(vcRes.error.code).json({ message: vcRes.error.msg });

  const seqStyle = (req.query.seq === 'of') ? 'of' : 'dash';
  const meta = prepareUrMeta(vcRes.vc, req.query.part, seqStyle);
  res.json({ scheme: 'ur', framesCount: meta.framesCount });
});

exports.qrEmbedFramePngByToken = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { ticket, error } = await loadTicketByTokenOr404(token);
  if (error) return res.status(error.code).json({ message: error.msg });

  const vcRes = await loadVcForTicketOr404(ticket);
  if (vcRes.error) return res.status(vcRes.error.code).json({ message: vcRes.error.msg });

  const i = Math.max(0, Number(req.query.i) || 0);
  const size = clamp(Number(req.query.size) || DEFAULT_QR_SIZE, MIN_QR_SIZE, MAX_QR_SIZE);
  const seqStyle = (req.query.seq === 'of') ? 'of' : 'dash';

  const meta = prepareUrMeta(vcRes.vc, req.query.part, seqStyle);
  const urPart = meta.frameStringAt(i);

  // text mode for debugging
  if (String(req.query.txt) === '1') {
    res.set('Cache-Control', 'no-store');
    return res.type('text/plain').send(urPart);
  }

  const buf = await QRCode.toBuffer(urPart, {
    width: size,
    margin: QR_MARGIN,
    errorCorrectionLevel: QR_ECL,
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  res.set('Content-Type', 'image/png');
  // Deterministic frames → allow short caching to avoid 429s on public pages
  res.set('Cache-Control', 'public, max-age=300, immutable');
  res.send(buf);
});

exports.qrEmbedPageByToken = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const size = clamp(Number(req.query.size) || DEFAULT_QR_SIZE, MIN_QR_SIZE, MAX_QR_SIZE);
  const fps = clamp(Number(req.query.fps) || 1, 1, 8); // slower is easier to scan
  const intervalMs = Math.round(1000 / fps);
  const seq = req.query.seq === 'of' ? '&seq=of' : '';
  const part = req.query.part ? `&part=${encodeURIComponent(req.query.part)}` : '';

  const base = baseUrl(req); // absolute to avoid cross-origin issues

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Offline VC QR</title>
<style>
  body { font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:#0b1020; color:#eee; margin:0; display:grid; place-items:center; height:100vh; }
  .wrap { display:flex; gap:24px; align-items:center; flex-direction:column; }
  .card { background:#121836; border-radius:16px; padding:18px 18px 8px 18px; box-shadow: 0 8px 20px rgba(0,0,0,.5); }
  img { width:${size}px; height:${size}px; image-rendering:pixelated; background:#fff; }
  .muted { opacity:.7; font-size:12px; }
  .row { display:flex; gap:14px; align-items:center; }
  code { background:#0f142b; padding:4px 8px; border-radius:6px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card"><img id="qr" alt="QR frame"/></div>
    <div class="row">
      <div>Frame: <code id="pos">—</code>/<code id="len">—</code></div>
      <div class="muted">FPS: ${fps}</div>
    </div>
    <div class="muted">Keep the phone steady; the wallet will reconstruct offline.</div>
  </div>
  <script>
    const tok = ${JSON.stringify(token)};
    const base = ${JSON.stringify(base)};
    const size = ${size};
    const intervalMs = ${intervalMs};
    const qs = ${JSON.stringify(seq + part)};
    let N = 0, i = 0;

    async function start() {
      const r = await fetch(base + '/c/'+tok+'/qr-embed/frames' + qs);
      const j = await r.json();
      if (!r.ok) { alert('Failed: '+(j.message||r.status)); return; }
      N = j.framesCount || 1; // UI only
      document.getElementById('len').textContent = N;
      setInterval(tick, intervalMs);
      tick();
    }
    async function tick() {
      document.getElementById('pos').textContent = ((i % N) + 1);
      const img = document.getElementById('qr');
      img.src = base + '/c/'+tok+'/qr-embed/frame?i='+i+'&size='+size + qs + '&_t=' + Date.now();
      i++;
    }
    start();
  </script>
</body>
</html>`;
  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
});

// ---------- create / redeem / admin list ----------
exports.createClaim = asyncHandler(async (req, res) => {
  const { credId, ttlDays = 7, singleActive = true } = req.body;
  const vc = await SignedVC.findById(credId).select('_id status');
  if (!vc) return res.status(404).json({ message: 'Credential not found' });
  if (vc.status !== 'active') return res.status(409).json({ message: 'VC not active' });

  const now = new Date();
  if (singleActive) {
    const existing = await ClaimTicket.findOne({
      cred_id: vc._id,
      expires_at: { $gt: now },
    }).sort({ createdAt: -1 });

    if (existing) {
      const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
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

  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.status(201).json({
    claim_id: created._id.toString(),
    token,
    claim_url: `${base}/c/${token}`,
    expires_at,
    reused: false,
  });
});

exports.redeemClaim = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const now = new Date();

  const ticket = await ClaimTicket.findOne({ token });
  if (!ticket) return res.status(404).json({ message: 'Claim token not found' });
  if (ticket.expires_at && ticket.expires_at < now) {
    return res.status(410).json({ message: 'Claim token expired' });
  }

  const vc = await SignedVC.findById(ticket.cred_id)
    .select('jws alg kid digest salt anchoring status');
  if (!vc) return res.status(404).json({ message: 'Credential not found' });
  if (vc.status !== 'active') return res.status(409).json({ message: 'Credential not active' });

  if (!ticket.used_at) {
    ticket.used_at = now;
    await ticket.save();
  }

  res.set('Cache-Control', 'no-store');
  res.json(buildVcPayload(vc));
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

  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

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

  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
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

  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const claimUrl = `${base}/c/${t.token}`;

  const size = clamp(Number(req.query.size) || 256, 120, 1024);
  const buf = await QRCode.toBuffer(claimUrl, { width: size, margin: 2 });

  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.send(buf);
});
