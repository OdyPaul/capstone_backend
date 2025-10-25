// server/mail.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail({ to, subject, text, html, replyTo }) {
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html,
    replyTo,
  });
  console.log("✅ Email sent:", info.messageId);
  return info;
}

module.exports = { sendMail, transporter };
