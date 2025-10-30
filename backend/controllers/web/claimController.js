// controllers/web/claimController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const ClaimTicket = require('../../models/web/claimTicket');
const SignedVC = require('../../models/web/signedVcModel');
const { randomToken } = require('../../utils/tokens');
const cbor = require('cbor');
const { deflateRawSync } = require('zlib');
const { UR, UREncoder } = require('@ngraveio/bc-ur');
const QRCode = require('qrcode');

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const isId = (id) => mongoose.Types.ObjectId.isValid(id);

const vcToPayload = (vc) => ({
  format: 'vc+jws',
  jws: vc.jws,
  kid: vc.kid,
  alg: vc.alg,
  salt: vc.salt,
  digest: vc.digest,
  anchoring: vc.anchoring,
});

async function fetchVcFromClaimId(claimId) {
  if (!isId(claimId)) return { error: { code: 400, msg: 'Invalid claim id' } };
  const t = await ClaimTicket.findById(claimId).lean();
  if (!t) return { error: { code: 404, msg: 'Claim not found' } };
  const vc = await SignedVC.findById(t.cred_id)
    .select('jws alg kid digest salt anchoring status')
    .lean();
  if (!vc) return { error: { code: 404, msg: 'Credential not found' } };
  if (!vc.jws) return { error: { code: 409, msg: 'VC has no JWS payload' } };
  if (vc.status && vc.status !== 'active') {
    return { error: { code: 409, msg: 'Credential not active' } };
  }
  return { vc };
}

async function fetchVcFromClaimToken(token) {
  const now = new Date();
  const t = await ClaimTicket.findOne({ token }).lean();
  if (!t) return { error: { code: 404, msg: 'Claim token not found' } };
  if (t.expires_at && t.expires_at < now) {
    return { error: { code: 410, msg: 'Claim token expired' } };
  }
  const vc = await SignedVC.findById(t.cred_id)
    .select('jws alg kid digest salt anchoring status')
    .lean();
  if (!vc) return { error: { code: 404, msg: 'Credential not found' } };
  if (!vc.jws) return { error: { code: 409, msg: 'VC has no JWS payload' } };
  if (vc.status && vc.status !== 'active') {
    return { error: { code: 409, msg: 'Credential not active' } };
  }
  return { vc };
}

function encodeToEncoder(vc) {
  const payload = vcToPayload(vc);
  const cborBytes = cbor.encode(payload);
  const deflated  = deflateRawSync(cborBytes);
  const ur        = UR.fromBuffer(deflated);
  return new UREncoder(ur, 400);
}

async function buildFramesCountFromVc(vc) {
  try {
    const enc = encodeToEncoder(vc);
    let n = 0;
    while (!enc.isComplete()) { enc.nextPart(); n++; }
    if (!n) return { error: { code: 500, msg: 'Failed to compute framesCount' } };
    return { framesCount: n };
  } catch (e) {
    return { error: { code: 500, msg: `Meta build failed: ${e.message || e}` } };
  }
}

async function buildFramesFromVc(vc) {
  try {
    const enc = encodeToEncoder(vc);
    const frames = [];
    while (!enc.isComplete()) frames.push(enc.nextPart());
    if (!frames.length) return { error: { code: 500, msg: 'Failed to build QR frames' } };
    return { frames };
  } catch (e) {
    return { error: { code: 500, msg: `Frame build failed: ${e.message || e}` } };
  }
}

/* =======================
 * ADMIN (by claim _id)
 * ======================= */

// Count only (lighter for the client)
exports.qrEmbedFrames = asyncHandler(async (req, res) => {
  try {
    const got = await fetchVcFromClaimId(req.params.id);
    if (got.error) return res.status(got.error.code).json({ message: got.error.msg });

    const meta = await buildFramesCountFromVc(got.vc);
    if (meta.error) return res.status(meta.error.code).json({ message: meta.error.msg });

    if (process.env.DEBUG_QR === '1') {
      console.log('[qrMeta]', {
        claimId: String(req.params.id),
        jwsLen: String(got.vc?.jws?.length || 0),
        framesCount: meta.framesCount,
      });
    }
    return res.json({ scheme: 'ur', framesCount: meta.framesCount });
  } catch (err) {
    console.error('qr-embed/frames error', req.params.id, err);
    return res.status(500).json({ message: 'qr-embed/frames failed', detail: String(err?.message || err) });
  }
});

exports.qrEmbedFramePng = asyncHandler(async (req, res) => {
  try {
    const i = Number(req.query.i ?? 0);
    const size = clamp(Number(req.query.size) || 280, 160, 560);

    const got = await fetchVcFromClaimId(req.params.id);
    if (got.error) return res.status(got.error.code).json({ message: got.error.msg });

    const built = await buildFramesFromVc(got.vc);
    if (built.error) return res.status(built.error.code).json({ message: built.error.msg });

    const frames = built.frames;
    if (!Number.isInteger(i) || i < 0 || i >= frames.length) {
      return res.status(400).json({ message: `frame index out of range 0..${frames.length - 1}` });
    }

    const buf = await QRCode.toBuffer(frames[i], { width: size, margin: 0, errorCorrectionLevel: 'M' });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    return res.send(buf);
  } catch (err) {
    console.error('qr-embed/frame error', req.params.id, err);
    return res.status(500).json({ message: 'qr-embed/frame failed', detail: String(err?.message || err) });
  }
});

exports.qrEmbedPage = asyncHandler(async (req, res) => {
  try {
    // Admin-protected page (kept as-is). NOTE: this page cannot attach JWT on fetch().
    const { id } = req.params;
    const size = clamp(Number(req.query.size) || 320, 160, 560);
    const fps = clamp(Number(req.query.fps) || 2, 1, 8);
    const intervalMs = Math.round(1000 / fps);

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
    img { width:${size}px; height:${size}px; image-rendering:pixelated; }
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
    <div class="muted">This admin page requires cookies/JWT to fetch frames.</div>
  </div>
  <script>
    const id = ${JSON.stringify(id)};
    const size = ${size};
    const intervalMs = ${intervalMs};
    let N = 0, i = 0, timer = null;

    async function start() {
      const res = await fetch('/api/web/claims/'+id+'/qr-embed/frames', { credentials: 'include' });
      const text = await res.text();
      if (!res.ok) { alert('Failed: '+(text||res.status)); return; }
      const meta = JSON.parse(text);
      N = meta.framesCount || 0;
      document.getElementById('len').textContent = N;
      if (!N) { alert('No frames'); return; }
      timer = setInterval(tick, intervalMs);
      tick();
    }

    async function tick() {
      document.getElementById('pos').textContent = (i+1);
      const img = document.getElementById('qr');
      img.src = '/api/web/claims/'+id+'/qr-embed/frame?i='+i+'&size='+size+'&_t='+(Date.now());
      i = (i+1) % N;
    }

    start();
  </script>
</body>
</html>`;
    res.set('Cache-Control', 'no-store');
    return res.type('html').send(html);
  } catch (err) {
    console.error('qr-embed/page error', req.params.id, err);
    return res.status(500).send('qr-embed/page failed');
  }
});

/* =======================
 * PUBLIC (by claim token)
 * Use these for the stand-alone page and for scanners without JWT.
 * ======================= */

exports.qrEmbedFramesByToken = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const got = await fetchVcFromClaimToken(token);
  if (got.error) return res.status(got.error.code).json({ message: got.error.msg });

  const meta = await buildFramesCountFromVc(got.vc);
  if (meta.error) return res.status(meta.error.code).json({ message: meta.error.msg });

  return res.json({ scheme: 'ur', framesCount: meta.framesCount });
});

exports.qrEmbedFramePngByToken = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const i = Number(req.query.i ?? 0);
  const size = clamp(Number(req.query.size) || 280, 160, 560);

  const got = await fetchVcFromClaimToken(token);
  if (got.error) return res.status(got.error.code).json({ message: got.error.msg });

  const built = await buildFramesFromVc(got.vc);
  if (built.error) return res.status(built.error.code).json({ message: built.error.msg });

  const frames = built.frames;
  if (!Number.isInteger(i) || i < 0 || i >= frames.length) {
    return res.status(400).json({ message: `frame index out of range 0..${frames.length - 1}` });
  }

  const buf = await QRCode.toBuffer(frames[i], { width: size, margin: 0, errorCorrectionLevel: 'M' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  return res.send(buf);
});

exports.qrEmbedPageByToken = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const size = clamp(Number(req.query.size) || 320, 160, 560);
  const fps = clamp(Number(req.query.fps) || 2, 1, 8);
  const intervalMs = Math.round(1000 / fps);

  // public HTML page that calls public endpoints (no JWT)
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
    img { width:${size}px; height:${size}px; image-rendering:pixelated; }
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
    <div class="muted">Keep the phone camera steady; it will auto-assemble the credential offline.</div>
  </div>
  <script>
    const token = ${JSON.stringify(token)};
    const size = ${size};
    const intervalMs = ${intervalMs};
    let N = 0, i = 0, timer = null;

    async function start() {
      const res = await fetch('/c/'+token+'/qr-embed/frames');
      const text = await res.text();
      if (!res.ok) { alert('Failed: '+(text||res.status)); return; }
      const meta = JSON.parse(text);
      N = meta.framesCount || 0;
      document.getElementById('len').textContent = N;
      if (!N) { alert('No frames'); return; }
      timer = setInterval(tick, intervalMs);
      tick();
    }

    async function tick() {
      document.getElementById('pos').textContent = (i+1);
      const img = document.getElementById('qr');
      img.src = '/c/'+token+'/qr-embed/frame?i='+i+'&size='+size+'&_t='+(Date.now());
      i = (i+1) % N;
    }

    start();
  </script>
</body>
</html>`;
  res.set('Cache-Control', 'no-store');
  return res.type('html').send(html);
});

/* =======================
 * Ticket create/list/get/qr (unchanged)
 * ======================= */

exports.createClaim = asyncHandler(async (req, res) => {
  const { credId, ttlDays = 7, singleActive = true } = req.body;
  const vc = await SignedVC.findById(credId).select('_id status');
  if (!vc) return res.status(404).json({ message: 'Credential not found' });
  if (vc.status !== 'active') return res.status(409).json({ message: 'VC not active' });

  const now = new Date();

  if (singleActive) {
    const existing = await ClaimTicket.findOne({ cred_id: vc._id, expires_at: { $gt: now } }).sort({ createdAt: -1 });
    if (existing) {
      const base = process.env.BASE_URL || 'https://issuer.example.edu';
      const claim_url = `${base}/c/${existing.token}`;
      return res.status(200).json({
        claim_id: existing._id.toString(),
        token: existing.token,
        claim_url,
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

  const base = process.env.BASE_URL || 'https://issuer.example.edu';
  const claim_url = `${base}/c/${token}`;

  return res.status(201).json({
    claim_id: created._id.toString(),
    token,
    claim_url,
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

  if (!ticket.used_at) { await ClaimTicket.updateOne({ _id: ticket._id }, { $set: { used_at: now } }); }

  res.set('Cache-Control', 'no-store');
  return res.json(vcToPayload(vc));
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

  const base = process.env.BASE_URL || 'https://issuer.example.edu';

  let rows = tickets.map(t => {
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

  if (status && ['active','used','expired'].includes(status)) {
    rows = rows.filter(r => r.status === status);
  }

  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(r =>
      (r.token || '').toLowerCase().includes(needle) ||
      (r.credential?.subjectName || '').toLowerCase().includes(needle) ||
      (r.credential?.studentNumber || '').toLowerCase().includes(needle) ||
      (r.credential?.template_id || '').toLowerCase().includes(needle)
    );
  }

  return res.json(rows);
});

exports.getClaim = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!isId(id)) return res.status(400).json({ message: 'Invalid claim id' });

  const t = await ClaimTicket.findById(id)
    .populate({ path: 'cred_id', model: SignedVC, select: 'template_id student_id vc_payload createdAt' });

  if (!t) return res.status(404).json({ message: 'Claim not found' });

  const base = process.env.BASE_URL || 'https://issuer.example.edu';
  const now = new Date();
  const computedStatus = t.expires_at < now ? 'expired' : (t.used_at ? 'used' : 'active');
  const subj = t.cred_id?.vc_payload?.credentialSubject || {};

  return res.json({
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
  const id = req.params.id;
  if (!isId(id)) return res.status(400).json({ message: 'Invalid claim id' });

  const t = await ClaimTicket.findById(id).lean();
  if (!t) return res.status(404).json({ message: 'Claim not found' });

  const base = process.env.BASE_URL || 'https://issuer.example.edu';
  const claimUrl = `${base}/c/${t.token}`;

  const size = Math.max(120, Math.min(1024, Number(req.query.size) || 256));
  const buf = await QRCode.toBuffer(claimUrl, { width: size, margin: 1 });

  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'private, no-store, max-age=0');
  return res.send(buf);
});
