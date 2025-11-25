// backend/controllers/common/passwordResetController.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const asyncHandler = require('express-async-handler');
const User = require('../../models/common/userModel');
const { sendMail } = require('../../utils/mail');

// In-memory stores (per-process) for OTP & reset sessions
const resetOtpStore = new Map();      // email -> { codeHash, expiresAt, attempts }
const resetSessionStore = new Map();  // email -> { resetSession, expiresAt }

const CODE_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const SESH_TTL_MS = 15 * 60 * 1000;   // 15 minutes
const MAX_ATTEMPTS = 5;

const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

// same idea as your mobile otpController
function resolveOtpRecipient(requestedEmail) {
  const testRecipient = process.env.RESEND_TEST_TO || 'nalahpen@gmail.com';
  const fromAddr = (process.env.SMTP_FROM || '').toLowerCase();
  const usingOnboarding = fromAddr.includes('onboarding@resend.dev');
  if (usingOnboarding) return testRecipient;
  return requestedEmail;
}

// --------------------------- 1) Request reset OTP ---------------------------
// POST /api/password/forgot
exports.requestResetOtp = asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  const emailNorm = String(email || '').toLowerCase().trim();
  if (!emailNorm) {
    res.status(400);
    throw new Error('Email required');
  }

  // User must exist (both web + mobile share the same collection)
  const user = await User.findOne({ email: emailNorm });
  if (!user) {
    // Do NOT leak that user doesn't exist; just respond OK
    return res.json({ success: true });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  resetOtpStore.set(emailNorm, {
    codeHash: hash(code),
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
  });

  const sendTo = resolveOtpRecipient(emailNorm);
  const msg = {
    to: sendTo,
    subject: 'Your password reset code',
    text: `Your password reset code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your password reset code is <b>${code}</b>. It expires in 10 minutes.</p>`,
  };

  try {
    const result = await sendMail(msg);
    const payload = { success: true, messageId: result?.id || null };
    if (process.env.NODE_ENV !== 'production') {
      payload.debugCode = code;
      payload.debugReroutedTo = sendTo;
    }
    return res.json(payload);
  } catch (err) {
    console.error('SendMail failed (reset OTP):', err);
    res.status(500);
    throw new Error('Failed to send email');
  }
});

// --------------------------- 2) Verify reset OTP ---------------------------
// POST /api/password/verify
exports.verifyResetOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body || {};
  const emailNorm = String(email || '').toLowerCase().trim();
  if (!emailNorm || !code) {
    res.status(400);
    throw new Error('Email and code required');
  }

  const rec = resetOtpStore.get(emailNorm);
  if (!rec) {
    res.status(400);
    throw new Error('No code requested');
  }
  if (rec.expiresAt < Date.now()) {
    resetOtpStore.delete(emailNorm);
    res.status(400);
    throw new Error('Code expired');
  }
  if (rec.attempts >= MAX_ATTEMPTS) {
    resetOtpStore.delete(emailNorm);
    res.status(429);
    throw new Error('Too many attempts');
  }

  rec.attempts += 1;
  if (rec.codeHash !== hash(code)) {
    res.status(400);
    throw new Error('Invalid code');
  }

  // success → issue short-lived resetSession & burn OTP
  const resetSession = crypto.randomBytes(24).toString('base64url');
  resetSessionStore.set(emailNorm, {
    resetSession,
    expiresAt: Date.now() + SESH_TTL_MS,
  });
  resetOtpStore.delete(emailNorm);

  res.json({ success: true, resetSession });
});

// --------------------------- 3) Apply new password --------------------------
// POST /api/password/reset
exports.applyNewPassword = asyncHandler(async (req, res) => {
  const { email, resetSession, newPassword } = req.body || {};
  const emailNorm = String(email || '').toLowerCase().trim();
  if (!emailNorm || !resetSession || !newPassword) {
    res.status(400);
    throw new Error('Email, resetSession, and newPassword are required');
  }

  const rec = resetSessionStore.get(emailNorm);
  if (!rec || rec.resetSession !== resetSession || rec.expiresAt < Date.now()) {
    resetSessionStore.delete(emailNorm);
    res.status(400);
    throw new Error('Invalid or expired reset session');
  }

  const user = await User.findOne({ email: emailNorm }).select('+password');
  if (!user) {
    // If user disappeared, just treat as success to avoid leaking info
    resetSessionStore.delete(emailNorm);
    return res.json({ success: true });
  }

  user.password = await bcrypt.hash(String(newPassword), 10);
  await user.save();
  resetSessionStore.delete(emailNorm);

  res.json({ success: true });
});
