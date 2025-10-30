// controllers/web/claimController.js
const asyncHandler = require('express-async-handler');
const ClaimTicket = require('../../models/web/claimTicket');
const SignedVC = require('../../models/web/signedVcModel');
const { randomToken } = require('../../utils/tokens');
const cbor = require('cbor');
const { deflateRawSync } = require('zlib');
const { UR, UREncoder } = require('@ngraveio/bc-ur');
const QRCode = require('qrcode');

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
exports.qrEmbedFramePng = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const i = Number(req.query.i ?? 0);
  const size = clamp(Number(req.query.size) || 280, 160, 560);

  const built = await buildEmbedFrames(id);
  if (built.error) { res.status(built.error.code); throw new Error(built.error.msg); }

  const frames = built.frames;
  if (!Number.isInteger(i) || i < 0 || i >= frames.length) {
    return res.status(400).json({ message: `frame index out of range 0..${frames.length-1}` });
  }

  const buf = await QRCode.toBuffer(frames[i], { width: size, margin: 0, errorCorrectionLevel: 'M' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(buf);
});
exports.qrEmbedPage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const size = clamp(Number(req.query.size) || 320, 160, 560);
  const fps  = clamp(Number(req.query.fps) || 2, 1, 8); // 2 fps default
  const intervalMs = Math.round(1000 / fps);

  // We’ll fetch frames count client-side; no heavy work here.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Offline VC QR</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#0b1020; color:#eee; margin:0; display:grid; place-items:center; height:100vh; }
    .wrap { display:flex; gap:24px; align-items:center; flex-direction:column; }
    .card { background:#121836; border-radius:16px; padding:18px 18px 8px 18px; box-shadow: 0 8px 20px rgba(0,0,0,.5); }
    img { width:${size}px; height:${size}px; image-rendering:pixelated; }
    .muted { opacity: .7; font-size: 12px; }
    .row { display:flex; gap:14px; align-items:center; }
    code { background:#0f142b; padding:4px 8px; border-radius:6px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <img id="qr" alt="QR frame"/>
    </div>
    <div class="row">
      <div>Frame: <code id="pos">—</code>/<code id="len">—</code></div>
      <div class="muted">FPS: ${fps}</div>
    </div>
    <div class="muted">Keep the phone camera steady; it will auto-assemble the credential offline.</div>
  </div>
  <script>
    const id = ${JSON.stringify(id)};
    const size = ${size};
    const intervalMs = ${intervalMs};
    let N = 0, i = 0, timer = null;

    async function start() {
      const meta = await fetch('/api/web/claims/'+id+'/qr-embed/frames').then(r => r.json());
      N = meta.framesCount || (meta.frames?.length ?? 0);
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
  res.type('html').send(html);
});

exports.qrEmbedFrames = asyncHandler(async (req, res) => {
  const t = await ClaimTicket.findById(req.params.id).lean();
  if (!t) { res.status(404); throw new Error('Claim not found'); }

  const vc = await SignedVC.findById(t.cred_id)
    .select('jws alg kid digest salt anchoring')
    .lean();

  const payload = {
    format: 'vc+jws',
    jws: vc.jws,
    kid: vc.kid,
    alg: vc.alg,
    salt: vc.salt,
    digest: vc.digest,
    anchoring: vc.anchoring,
  };

  // encode -> compress -> UR-encode
  const cborBytes = cbor.encode(payload);
  const deflated = deflateRawSync(cborBytes);
  const ur = UR.fromBuffer(deflated);
  const encoder = new UREncoder(ur, 400); // 400 B/frame ≈ reliable size

  const frames = [];
  while (!encoder.isComplete()) frames.push(encoder.nextPart());
  res.json({ scheme: 'ur', framesCount: frames.length, frames });
});
exports.createClaim = asyncHandler(async (req, res) => {
  const { credId, ttlDays = 7, singleActive = true } = req.body; // optional knobs
  const vc = await SignedVC.findById(credId).select('_id status');
  if (!vc) { res.status(404); throw new Error('Credential not found'); }
  if (vc.status !== 'active') { res.status(409); throw new Error('VC not active'); }

  const now = new Date();

  // Reuse latest unexpired ticket if policy says only one active
  if (singleActive) {
    const existing = await ClaimTicket
      .findOne({ cred_id: vc._id, expires_at: { $gt: now } })
      .sort({ createdAt: -1 });

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

  // Otherwise create a fresh ticket
  const token = randomToken();
  const expires_at = new Date(now.getTime() + Number(ttlDays) * 864e5);
  const created = await ClaimTicket.create({
    token,
    cred_id: vc._id,
    expires_at,
    created_by: req.user?._id || null, // tolerate unauthenticated contexts if needed
  });

  const base = process.env.BASE_URL || 'https://issuer.example.edu';
  const claim_url = `${base}/c/${token}`;

    return res.status(201).json({
        claim_id: created._id.toString(),
        token,
        claim_url,
        expires_at,
        reused: false
      });

});

exports.redeemClaim = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const now = new Date();

  const ticket = await ClaimTicket.findOne({ token });
  if (!ticket) { res.status(404); throw new Error('Claim token not found'); }
  if (ticket.expires_at && ticket.expires_at < now) { res.status(410); throw new Error('Claim token expired'); }

  const vc = await SignedVC.findById(ticket.cred_id)
    .select('jws alg kid digest salt anchoring status');
  if (!vc) { res.status(404); throw new Error('Credential not found'); }
  if (vc.status !== 'active') { res.status(409); throw new Error('Credential not active'); }

  if (!ticket.used_at) { ticket.used_at = now; await ticket.save(); } // idempotent mark

  res.set('Cache-Control', 'no-store');
  res.json({
    format: 'vc+jws',
    jws: vc.jws,
    kid: vc.kid,
    alg: vc.alg,
    salt: vc.salt,
    digest: vc.digest,
    anchoring: vc.anchoring,
  });
});

// ⬇️ ADD: list all claims (with filters)
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
    const computedStatus =
      t.expires_at < now ? 'expired' : (t.used_at ? 'used' : 'active');

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

  res.json(rows);
});

// ⬇️ ADD: get one claim (handy for a details drawer)
exports.getClaim = asyncHandler(async (req, res) => {
  const t = await ClaimTicket.findById(req.params.id)
    .populate({ path: 'cred_id', model: SignedVC, select: 'template_id student_id vc_payload createdAt' });

  if (!t) { res.status(404); throw new Error('Claim not found'); }

  const base = process.env.BASE_URL || 'https://issuer.example.edu';
  const now = new Date();
  const computedStatus =
    t.expires_at < now ? 'expired' : (t.used_at ? 'used' : 'active');

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

// ⬇️ ADD: serve a QR image for the modal
// npm i qrcode
const QRCode = require('qrcode');

exports.qrPng = asyncHandler(async (req, res) => {
  const t = await ClaimTicket.findById(req.params.id).lean();
  if (!t) { res.status(404); throw new Error('Claim not found'); }

  const base = process.env.BASE_URL || 'https://issuer.example.edu';
  const claimUrl = `${base}/c/${t.token}`;

  const size = Math.max(120, Math.min(1024, Number(req.query.size) || 256));
  const buf = await QRCode.toBuffer(claimUrl, { width: size, margin: 1 });

  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.send(buf);
});