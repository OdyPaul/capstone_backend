// utils/mail.js
const { Resend } = require("resend");
const nodemailer = require("nodemailer");

const {
  RESEND_API_KEY,
  MAIL_FROM,        // e.g. '"AAS Wallet" <noreply@yourdomain.com>'
  RESEND_FROM,      // optional; fallback if MAIL_FROM empty
  NODE_ENV,
  EMAIL_TRANSPORT,  // optional: set to 'ethereal' to force dev fallback
} = process.env;

const isProd = NODE_ENV === "production";
const useEthereal = EMAIL_TRANSPORT === "ethereal" || (!RESEND_API_KEY && !isProd);

let resend = null;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
}

/**
 * Send an email using Resend (prod) or Ethereal (dev fallback).
 * Returns { messageId, previewUrl? }.
 */
async function sendMail({ to, subject, text, html }) {
  const from = MAIL_FROM || RESEND_FROM || "onboarding@resend.dev";

  // ---- DEV FALLBACK (Ethereal) ----
  if (useEthereal) {
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: text || "",
      html: html || (text ? `<p>${text}</p>` : undefined),
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) console.log("📧 Ethereal preview:", previewUrl);
    return { messageId: info.messageId, previewUrl };
  }

  // ---- RESEND (preferred in prod) ----
  try {
    // IMPORTANT: Resend returns { data, error } (no throw on error)
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      text: text || "",
      html: html || (text ? `<p>${text}</p>` : undefined),
    });

    if (error) {
      // Surface full error details for debugging
      console.error("❌ Resend error:", {
        name: error.name,
        message: error.message,
        statusCode: error.statusCode,
      });
      throw new Error(error.message || "Failed to send email via Resend");
    }

    console.log("✅ Resend email id:", data?.id);
    return { messageId: data?.id || null };
  } catch (e) {
    // As a last resort in dev, silently fall back to Ethereal
    if (!isProd) {
      console.warn("Resend failed; falling back to Ethereal in dev:", e?.message);
      return sendMailEtherealFallback({ to, subject, text, html, from });
    }
    throw e;
  }
}

async function sendMailEtherealFallback({ to, subject, text, html, from }) {
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
  const info = await transporter.sendMail({
    from: from || '"CredPocket(Dev)" <noreply@example.com>',
    to,
    subject,
    text: text || "",
    html: html || (text ? `<p>${text}</p>` : undefined),
  });
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) console.log("📧 Ethereal preview:", previewUrl);
  return { messageId: info.messageId, previewUrl };
}

module.exports = { sendMail };
