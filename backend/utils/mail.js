// utils/mail.js
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// In dev, you can safely use onboarding@resend.dev if you don't have a verified domain yet.
// In prod, set SMTP_FROM to something like "Your App <no-reply@your-verified-domain.com>"
const FROM_DEFAULT =
  process.env.SMTP_FROM || "CredPocket <onboarding@resend.dev>";

async function sendMail({ to, subject, text, html }) {
  if (!process.env.RESEND_API_KEY) {
    // Dev fallback: don't fail hard if key is missing; just log and pretend
    console.warn("⚠️ RESEND_API_KEY missing. Printing email to console instead.");
    console.log("TO:", to);
    console.log("SUBJECT:", subject);
    console.log("TEXT:", text || "");
    console.log("HTML:", html || "");
    return { id: "dev-no-api-key" };
  }

  // Resend expects a string or string[] for "to"
  const toList = Array.isArray(to) ? to : [to];

  const { data, error } = await resend.emails.send({
    from: FROM_DEFAULT,
    to: toList,
    subject,
    html: html || (text ? `<p>${text}</p>` : "<p>(no content)</p>"),
    text: text || undefined,
  });

  if (error) {
    // This is the important bit: Resend doesn't throw; you must check error yourself
    console.error("❌ Resend sendMail failed:", error);
    throw new Error(error.message || "Failed to send email");
  }

  console.log("✅ Email sent via Resend:", data?.id);
  return data; // { id, ... }
}

module.exports = { sendMail };
