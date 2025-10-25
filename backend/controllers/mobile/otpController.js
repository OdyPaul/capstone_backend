const crypto = require("crypto");
const { sendMail } = require("../../utils/mail");

const otpStore = new Map();      // email -> { codeHash, expiresAt, attempts }
const sessionStore = new Map();  // email -> { otpSession, expiresAt }

const CODE_TTL_MS = 10 * 60 * 1000;   // 10 min
const SESH_TTL_MS = 15 * 60 * 1000;   // 15 min
const MAX_ATTEMPTS = 5;

const hash = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

exports.requestOtp = async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: "Email required" });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(email.toLowerCase(), {
    codeHash: hash(code),
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
  });

  await sendMail({
    to: email,
    subject: "Your verification code",
    text: `Your code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your code is <b>${code}</b>. It expires in 10 minutes.</p>`,
  });

  res.json({ success: true });
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

// used by middleware
exports.consumeOtpSession = (email, otpSession) => {
  const key = email.toLowerCase();
  const s = sessionStore.get(key);
  if (!s) return false;
  if (s.expiresAt < Date.now()) { sessionStore.delete(key); return false; }
  if (s.otpSession !== otpSession) return false;
  sessionStore.delete(key); // one-time use
  return true;
};
