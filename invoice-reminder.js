import 'dotenv/config';
import nodemailer from 'nodemailer';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getStripeSnapshot } from './stripe-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadManualClients() {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, 'manual-clients.json'), 'utf8'));
  } catch { return []; }
}

const testing = process.env.TESTING_MODE !== 'false';
const weekLabel = new Date().toLocaleDateString('en-SG', { month: 'short', day: 'numeric', year: 'numeric' });

// Pull live Stripe data
let stripe = null;
try {
  stripe = await getStripeSnapshot();
} catch (e) {
  console.log('⚠ Stripe unavailable (rate limit or error):', e.message);
}

// Pull live Xero AR
let ar = null;
try {
  const { getARSnapshot } = await import('./ar-check.js');
  ar = await getARSnapshot();
} catch (e) {
  console.log('⚠ Xero AR unavailable:', e?.message || String(e));
}

// Stripe: renewals in next 14 days
const renewingRows = (stripe?.subscriptions || [])
  .filter(s => {
    const days = Math.ceil((new Date(s.currentPeriodEnd) - new Date()) / 86400000);
    return days >= 0 && days <= 14;
  })
  .map(s => {
    const days = Math.ceil((new Date(s.currentPeriodEnd) - new Date()) / 86400000);
    return `<tr><td style="padding:6px 8px;border-bottom:1px solid #f4f4f4"><strong>${s.customerName}</strong></td><td style="padding:6px 8px;border-bottom:1px solid #f4f4f4">${s.currency} ${(s.amount/100).toFixed(2)}/${s.interval}</td><td style="padding:6px 8px;border-bottom:1px solid #f4f4f4">${s.currentPeriodEnd}</td><td style="padding:6px 8px;border-bottom:1px solid #f4f4f4;color:${days <= 3 ? '#dc2626' : '#d97706'}"><strong>${days}d</strong></td></tr>`;
  });

// Xero: overdue invoices sorted by urgency
const overdueRows = ar?.overdue?.length > 0
  ? [...ar.overdue]
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .map(i => `
      <tr style="${i.daysOverdue > 14 ? 'background:#fff5f5' : ''}">
        <td style="padding:6px 8px;border-bottom:1px solid #f4f4f4"><strong>${i.contact}</strong></td>
        <td style="padding:6px 8px;border-bottom:1px solid #f4f4f4">${i.currency} ${i.amountDue}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f4f4f4">${i.dueDate}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f4f4f4"><strong style="color:${i.daysOverdue > 30 ? '#dc2626' : '#d97706'}">${i.daysOverdue} days</strong></td>
        <td style="padding:6px 8px;border-bottom:1px solid #f4f4f4">${i.status}</td>
      </tr>`)
    .join('')
  : '<tr><td colspan="5" style="padding:8px;color:#16a34a;text-align:center">✓ No overdue invoices in Xero</td></tr>';

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #111; max-width: 700px; margin: 0 auto; padding: 24px; }
  h2 { font-size: 18px; font-weight: 900; margin-bottom: 4px; }
  .section { margin-bottom: 22px; }
  .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #555; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #aaa; text-align: left; padding: 4px 8px; border-bottom: 1px solid #eee; }
  ol { padding-left: 18px; line-height: 1.9; }
  .footer { border-top: 1px solid #eee; padding-top: 10px; font-size: 10px; color: #aaa; margin-top: 24px; }
</style></head><body>
<h2>💸 Weekly Invoice & AR Chase — ${weekLabel}</h2>
<p style="color:#666">Hi Charlene — here's your weekly collections and billing checklist.</p>

${ar ? (ar.overdue.length > 0 ? `
<div class="section">
  <div class="section-title">🔴 Overdue Invoices — Chase These This Week</div>
  <table>
    <thead><tr><th>Client</th><th>Amount Due</th><th>Due Date</th><th>Days Overdue</th><th>Status</th></tr></thead>
    <tbody>${overdueRows}</tbody>
  </table>
  <p style="font-size:11px;color:#666;margin-top:8px">For each: call or email the contact → log the outcome in Trello → set a follow-up if no response within 2 days.</p>
</div>` : `
<div class="section">
  <div class="section-title">✅ Overdue Invoices</div>
  <p style="color:#16a34a">No overdue invoices in Xero this week.</p>
</div>`) : ''}

${renewingRows.length > 0 ? `
<div class="section">
  <div class="section-title">🔄 Stripe Renewals — Next 14 Days</div>
  <table>
    <thead><tr><th>Subscriber</th><th>Plan</th><th>Renews On</th><th>Days Left</th></tr></thead>
    <tbody>${renewingRows.join('')}</tbody>
  </table>
</div>` : ''}

<div class="section">
  <div class="section-title">📝 Manual Invoices to Generate This Week (Xero)</div>
  <ol>
    ${loadManualClients().map(c => `<li><strong>${c.name}</strong> — ${c.amount} ${c.description}</li>`).join('')}
    <li>Any new enterprise clients onboarded this week</li>
  </ol>
</div>

<div class="footer">Auto-generated by dasho-ops · Fires every Monday at 8am · Source: Stripe API + Xero API</div>
</body></html>`;

// Save to disk
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `invoice-reminder-${new Date().toISOString().slice(0, 10)}.html`), html);
console.log('✓ Invoice reminder report saved to output/');

// Email
const appPassword = process.env.GMAIL_APP_PASSWORD;
if (appPassword) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: appPassword },
  });
  const to = testing ? process.env.EMAIL_FLEIRE : process.env.EMAIL_CHARLENE;
  const cc = testing ? undefined : process.env.EMAIL_FLEIRE;
  const overdueCount = ar?.overdue?.length || 0;
  const subject = `${testing ? '[TEST] ' : ''}Weekly Invoice Chase — ${ar ? `${overdueCount} overdue` : 'collections checklist'} · ${weekLabel}`;
  await transporter.sendMail({
    from: `"DashoContent Ops" <${process.env.GMAIL_USER}>`,
    to, cc, subject, html,
  });
  console.log(`✓ Invoice chase email sent to ${to}${testing ? ' (TESTING MODE)' : ''}`);
} else {
  console.log('⚠ GMAIL_APP_PASSWORD not set');
}

// Slack
const webhookUrl = process.env.SLACK_WEBHOOK_URL;
if (webhookUrl) {
  const overdueCount = ar?.overdue?.length || 0;
  const overdueSlack = ar
    ? (overdueCount === 0
      ? '✅ No overdue invoices'
      : ar.overdue.sort((a,b) => b.daysOverdue - a.daysOverdue).slice(0, 5)
          .map(i => `• *${i.contact}* — ${i.currency} ${i.amountDue} · ${i.daysOverdue}d overdue`).join('\n')
          + (overdueCount > 5 ? `\n_…and ${overdueCount - 5} more_` : ''))
    : null;

  const stripeCtx = stripe
    ? `MRR: *$${stripe.totalMRR}* · ${stripe.subscriberCount} subs · ${stripe.failedPayments > 0 ? `⚠ ${stripe.failedPayments} failed payment${stripe.failedPayments > 1 ? 's' : ''}` : '✅ no failed payments'}`
    : '_Stripe unavailable_';
  const renewalList = stripe?.subscriptions
    .filter(s => { const d = Math.ceil((new Date(s.currentPeriodEnd) - new Date()) / 86400000); return d >= 0 && d <= 14; })
    .map(s => `${s.customerName} (${s.currentPeriodEnd})`)
    .join(' · ') || null;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `💸 Weekly Invoice Chase — ${weekLabel}${testing ? ' [TEST]' : ''}` } },
        { type: 'section', fields: [
          ...(overdueSlack ? [{ type: 'mrkdwn', text: `📋 *Overdue (${overdueCount}):*\n${overdueSlack}` }] : []),
          { type: 'mrkdwn', text: `💳 *Stripe:*\n${stripeCtx}` },
        ]},
        renewalList
          ? { type: 'section', text: { type: 'mrkdwn', text: `🔄 *Renewals in 14 days:* ${renewalList}` }}
          : null,
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'Full checklist emailed · Chase all overdue → log in Trello → generate manual invoices in Xero' }]},
      ].filter(Boolean)
    }),
  });
  console.log('✓ Invoice chase Slack sent');
}
