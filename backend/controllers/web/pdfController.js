// backend/controllers/web/pdfController.js
const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const VerificationSession = require("../../models/web/verificationSessionModel");
const launchBrowser = require("../../utils/launchBrowser");

/** HMAC signer */
function hmac(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * Build a short-lived, single-use, signed URL that renders a PDF for a session.
 * Used by verificationController.submitPresentation after a successful verify.
 */
function _buildSignedTorFromSessionUrl({ base, sessionId, ttlMin = 15 }) {
  const PRINT_URL_SECRET = process.env.PRINT_URL_SECRET || "dev-secret-change-me";
  const exp = Date.now() + Math.max(1, Number(ttlMin)) * 60 * 1000;
  const tok = crypto.randomBytes(10).toString("base64url"); // single-use token
  const payload = `sid=${sessionId}&exp=${exp}&tok=${tok}`;
  const sig = hmac(payload, PRINT_URL_SECRET);
  const sep = base.includes("?") ? "&" : base.includes("/api") ? "" : "";
  const urlBase = `${base.replace(/\/+$/, "")}/api/web/pdf/tor-from-session`;
  return `${urlBase}?${payload}&sig=${sig}`;
}

/**
 * GET /api/web/pdf/tor-from-session?sid=...&exp=...&tok=...&sig=...
 * Verifies signature & expiry, enforces single-use, and streams a PDF.
 */
const torFromSessionSigned = asyncHandler(async (req, res) => {
  const { sid, exp, tok, sig } = req.query || {};
  const PRINT_URL_SECRET = process.env.PRINT_URL_SECRET || "dev-secret-change-me";

  if (!sid || !exp || !tok || !sig) return res.status(400).send("Missing params");

  // Verify HMAC & TTL
  const base = `sid=${sid}&exp=${exp}&tok=${tok}`;
  const expect = hmac(base, PRINT_URL_SECRET);
  if (sig !== expect) return res.status(403).send("Bad signature");
  if (Date.now() > Number(exp)) return res.status(410).send("Link expired");

  // Load session and ensure we have a completed result
  const sess = await VerificationSession.findOne({ session_id: sid });
  if (!sess) return res.status(404).send("Session not found");

  // Enforce single-use token (store under result.meta.print_tokens_used[])
  const used = Array.isArray(sess?.result?.meta?.print_tokens_used)
    ? sess.result.meta.print_tokens_used
    : [];
  if (used.includes(tok)) return res.status(410).send("Link already used");
  // Only allow when we have a result and it’s either ok or not_anchored
  const r = sess.result || {};
  if (!r || r.reason === "pending") return res.status(409).send("Not ready");
  if (!(r.valid || r.reason === "not_anchored")) {
    return res.status(403).send("Verification failed");
  }

  // Compose printable data (attached by submitPresentation)
  const meta = r.meta || {};
  const printable = meta.printable || {}; // { fullName, studentNumber, …, subjects: [] }
  const anch = meta.anchoring || {};
  const anchored = (anch.state || "").toLowerCase() === "anchored" && !!anch.merkle_root;

  // Minimal HTML → PDF rendering (Puppeteer)
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const title = anchored ? "Transcript of Records – VERIFIED" : "Transcript of Records – NOT ANCHORED";
    const banner = anchored
      ? `<div style="padding:8px 12px;background:#ecfdf5;border:1px solid #10b98155;color:#065f46;font-weight:700;border-radius:8px">VERIFIED on ${
          {137: "Polygon", 80002: "Polygon Amoy"}[anch.chain_id] || anch.chain_id || "Chain"
        } — Root: ${anch.merkle_root || "-"} — Tx: ${anch.tx_hash || "-"}</div>`
      : `<div style="padding:8px 12px;background:#fff7ed;border:1px solid #fdba7455;color:#9a3412;font-weight:700;border-radius:8px">NOT ANCHORED — cryptographic receipt not yet on-chain</div>`;

    const subjectRows = (Array.isArray(printable.subjects) ? printable.subjects : [])
      .map(
        (s) => `<tr>
      <td>${s.yearLevel || ""}</td>
      <td>${s.semester || ""}</td>
      <td>${s.subjectCode || ""}</td>
      <td>${s.subjectDescription || ""}</td>
      <td style="text-align:center">${s.units ?? ""}</td>
      <td style="text-align:center">${s.finalGrade ?? ""}</td>
    </tr>`
      )
      .join("");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;margin:24px}
  h1{font-size:20px;margin:0 0 8px;font-weight:800}
  h2{font-size:14px;margin:18px 0 6px;font-weight:800}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .card{border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin:12px 0}
  .meta b{display:inline-block;min-width:140px}
  table{width:100%;border-collapse:collapse;border:1px solid #e5e7eb;margin-top:8px}
  th,td{border:1px solid #e5e7eb;padding:6px 8px;font-size:12px}
  th{background:#f8fafc;text-align:left}
  .footer{margin-top:20px;font-size:11px;color:#6b7280}
  .watermark{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;opacity:.08;font-size:80px;font-weight:900;letter-spacing:6px;transform:rotate(-20deg)}
</style>
</head>
<body>
  <div class="watermark">${anchored ? "VERIFIED" : "NOT ANCHORED"}</div>
  <h1>${title}</h1>
  ${banner}
  <div class="card meta">
    <div class="grid">
      <div><b>Holder:</b> ${printable.fullName || meta.holder_name || "-"}</div>
      <div><b>Student #:</b> ${printable.studentNumber || "-"}</div>
      <div><b>Program:</b> ${printable.program || "-"}</div>
      <div><b>Major:</b> ${printable.major || "-"}</div>
      <div><b>Date Admitted:</b> ${printable.dateAdmission || "-"}</div>
      <div><b>Date Graduated:</b> ${printable.dateGraduated || "-"}</div>
      <div><b>GWA:</b> ${printable.gwa || "-"}</div>
    </div>
  </div>

  <h2>Subjects</h2>
  <table>
    <thead><tr>
      <th>Year</th><th>Term</th><th>Code</th><th>Description</th><th>Units</th><th>Grade</th>
    </tr></thead>
    <tbody>${subjectRows || `<tr><td colspan="6" style="text-align:center;color:#6b7280">No subjects listed</td></tr>`}</tbody>
  </table>

  <div class="footer">
    Session: ${sid} • Reason: ${r.reason} • Generated: ${new Date().toISOString()}<br/>
    This PDF is a human-readable snapshot. Verification receipt can be reproduced by re-running checks against the Merkle root and transaction shown above.
  </div>
</body>
</html>`;

    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "16mm", left: "12mm" },
    });

    // Mark token as used (single-use)
    const nextUsed = Array.isArray(used) ? [...used, tok] : [tok];
    sess.result = {
      ...(sess.result || {}),
      meta: { ...(sess.result?.meta || {}), print_tokens_used: nextUsed, printed_at: new Date() },
    };
    sess.markModified("result");
    await sess.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } finally {
    try { await browser.close(); } catch {}
  }
});

module.exports = {
  _buildSignedTorFromSessionUrl,
  torFromSessionSigned,
};
