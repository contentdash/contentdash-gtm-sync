import 'dotenv/config';
import nodemailer from 'nodemailer';

export function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD not set');
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
}

export async function sendEmail({ subject, html, to, cc }) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"DashoContent Ops" <${process.env.GMAIL_USER}>`,
    to, cc, subject, html,
  });
}

// testing === true  → send to Fleire only
// testing === false → send to Charlene, cc Fleire
export function resolveRecipients(testing = true) {
  const fleire = process.env.EMAIL_FLEIRE || 'info@contentdash.app';
  const charlene = process.env.EMAIL_CHARLENE || 'cvirlouvet@contentdash.app';
  if (testing) return { to: fleire, cc: undefined };
  return { to: charlene, cc: fleire };
}
