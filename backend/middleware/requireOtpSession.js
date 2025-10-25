const { consumeOtpSession } = require("../controllers/mobile/otpController");

module.exports = function requireOtpSession(req, res, next) {
  const { email, otpSession } = req.body || {};
  if (!email || !otpSession) {
    return res.status(400).json({ message: "Email and otpSession required" });
  }
  const ok = consumeOtpSession(email, otpSession);
  if (!ok) return res.status(400).json({ message: "Invalid or expired verification session" });
  next();
};
