// utils/mail.js
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendMail({ to, subject, text, html }) {
  const data = await resend.emails.send({
    from: process.env.SMTP_FROM || "AAS Wallet <noreply@yourdomain.com>",
    to,
    subject,
    html: html || `<p>${text}</p>`,
  });
  console.log("✅ Email sent:", data.id);
  return data;
}

module.exports = { sendMail };
