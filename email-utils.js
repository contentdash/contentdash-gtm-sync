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

// 2026-05-15: Charlene removed from email path. GTM/MRR-flavored content
// now goes to Slack #core-ops via SLACK_WEBHOOK_URL. Fleire keeps email copy.
export function resolveRecipients(_testing = true) {
  const fleire = process.env.EMAIL_FLEIRE || 'info@contentdash.app';
  return { to: fleire, cc: undefined };
}
