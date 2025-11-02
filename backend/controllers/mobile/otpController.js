// controllers/mobile/otpController.js
const crypto = require("crypto");
const { sendMail } = require("../../utils/mail");

const otpStore = new Map();      // email -> { codeHash, expiresAt, attempts }
const sessionStore = new Map();  // email -> { otpSession, expiresAt }

const CODE_TTL_MS = 10 * 60 * 1000;   // 10 min
const SESH_TTL_MS = 15 * 60 * 1000;   // 15 min
const MAX_ATTEMPTS = 5;

const hash = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

// helper: where to send during sandbox/dev
function resolveOtpRecipient(requestedEmail) {
  // If you haven't verified a domain, you must send to your own email.
  // Put your own email in RESEND_TEST_TO (fallback to the address Resend shows in the error).
  const testRecipient = process.env.RESEND_TEST_TO || "nalahpen@gmail.com";

  // If SMTP_FROM uses onboarding@resend.dev OR you haven't verified a domain yet,
  // force sending to testRecipient.
  const fromAddr = (process.env.SMTP_FROM || "").toLowerCase();
  const usingOnboarding = fromAddr.includes("onboarding@resend.dev");

  if (usingOnboarding) return testRecipient;

  // If you *have* a verified domain and SMTP_FROM is set to that domain email,
  // you can safely send to the requested recipient.
  return requestedEmail;
}

exports.requestOtp = async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: "Email required" });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(email.toLowerCase(), {
    codeHash: hash(code),
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
  });

  try {
    const sendTo = resolveOtpRecipient(email);
    const msg = {
      to: sendTo,
      subject: "Your verification code",
      text: `Your code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your code is <b>${code}</b>. It expires in 10 minutes.</p>`,
    };
    const result = await sendMail(msg);

    const payload = { success: true, messageId: result?.id || null };

    // In non-production, include the code to speed up testing
    if (process.env.NODE_ENV !== "production") {
      payload.debugCode = code;
      payload.debugReroutedTo = sendTo;
    }

    return res.json(payload);
  } catch (err) {
    console.error("SendMail failed:", err);
    return res.status(500).json({
      message: "Failed to send email",
      error: err.message,
    });
  }
};

exports.verifyOtp = async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ message: "Email and code required" });

  const key = email.toLowerCase();
  const rec = otpStore.get(key);
  if (!rec) return res.status(400).json({ message: "No code requested" });
  if (rec.expiresAt < Date.now()) { otpStore.delete(key); return res.status(400).json({ message: "Code expired" }); }
  if (rec.attempts >= MAX_ATTEMPTS) { otpStore.delete(key); return res.status(429).json({ message: "Too many attempts" }); }

  rec.attempts += 1;
  if (rec.codeHash !== hash(code)) return res.status(400).json({ message: "Invalid code" });

  // success -> mint short-lived session & burn code
  const otpSession = crypto.randomBytes(24).toString("base64url");
  sessionStore.set(key, { otpSession, expiresAt: Date.now() + SESH_TTL_MS });
  otpStore.delete(key);

  res.json({ success: true, otpSession });
};

// export.consumeOtpSession remains unchanged…
