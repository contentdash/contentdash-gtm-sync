import 'dotenv/config';
import nodemailer from 'nodemailer';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getStripeSnapshot } from './stripe-report.js';
import { getGTMSnapshot } from './gtm-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dateLabel = new Date().toLocaleDateString('en-SG', { weekday: 'long', month: 'short', day: 'numeric' });
const testing = process.env.TESTING_MODE !== 'false';

// Pull all sources in parallel — any failure silently omits that section
const [stripeResult, gtmResult, arResult] = await Promise.allSettled([
  getStripeSnapshot(),
  getGTMSnapshot(),
  (async () => {
    const { getARSnapshot } = await import('./ar-check.js');
    return getARSnapshot();
  })(),
]);

const stripe = stripeResult.status === 'fulfilled' ? stripeResult.value : null;
const gtm = gtmResult.status === 'fulfilled' ? gtmResult.value : null;
const ar = arResult.status === 'fulfilled' ? arResult.value : null;
const pipeline = gtm?.pipeline || null;
const inbound = gtm?.inbound || null;

// ─── Numbers block (auto-pulled) ──────────────────────────────────────────────

let stripeRows = '';
if (stripe) {
  const failedNote = stripe.failedPayments > 0
    ? `<tr><td>Failed payments</td><td><strong style="color:#dc2626">${stripe.failedPayments} unpaid — follow up needed</strong></td></tr>`
    : '';
  const newSubNote = stripe.growth?.newSubDetails?.length > 0
    ? `<tr><td>New subscribers</td><td style="color:#16a34a">${stripe.growth.newSubDetails.map(s => s.customer).join(', ')}</td></tr>`
    : '';
  stripeRows = `
    <tr><td>Platform MRR</td><td><strong>$${stripe.totalMRR}</strong> USD equiv.</td></tr>
    <tr><td>Collected (30 days)</td><td><strong>$${stripe.collectedLast30Days}</strong> via Stripe</td></tr>
    <tr><td>Active subscribers</td><td>${stripe.subscriberCount}</td></tr>
    ${newSubNote}
    ${failedNote}`;
}

let pipelineRows = '';
if (pipeline) {
  const stageStr = Object.entries(pipeline.stageCounts)
    .filter(([s]) => !['Won', 'Lost'].includes(s))
    .map(([s, c]) => `${s}: ${c}`)
    .join(' · ') || '—';
  const wonNote = pipeline.wonThisWeek > 0
    ? `<tr><td>Won this week</td><td><strong style="color:#16a34a">${pipeline.wonThisWeekDetails.map(d => d.account).join(', ')}</strong></td></tr>`
    : '';
  const staleNote = pipeline.staleDeals.length > 0
    ? `<tr><td style="color:#d97706">Needs contact</td><td style="color:#d97706">${pipeline.staleDeals.map(d => `${d.account} (${d.daysSince}d)`).join(', ')}</td></tr>`
    : '';
  const overdueNote = pipeline.overdueNextSteps.length > 0
    ? `<tr><td style="color:#dc2626">Overdue next steps</td><td style="color:#dc2626">${pipeline.overdueNextSteps.map(d => d.account).join(', ')}</td></tr>`
    : '';
  pipelineRows = `
    <tr><td>Active deals</td><td><strong>${pipeline.totalDeals}</strong> · $${pipeline.totalPipelineValue.toLocaleString()} pipeline</td></tr>
    <tr><td>Stage breakdown</td><td style="font-size:11px;color:#555">${stageStr}</td></tr>
    ${pipeline.proposalConvRate > 0 ? `<tr><td>Proposal conv. rate</td><td>${pipeline.proposalConvRate}%</td></tr>` : ''}
    ${wonNote}
    ${staleNote}
    ${overdueNote}`;
}

let inboundRows = '';
if (inbound && inbound.newThisWeek > 0) {
  inboundRows = `<tr><td>New inbound leads</td><td><strong>${inbound.newThisWeek}</strong> this week (${inbound.total} total in Airtable)</td></tr>
    ${inbound.recent.slice(0, 3).map(l =>
      `<tr><td style="padding-left:14px;color:#aaa;font-size:11px">${l.createdAt}</td><td style="font-size:11px;color:#555">${l.account}${l.email ? ` · ${l.email}` : ''}</td></tr>`
    ).join('')}`;
} else if (inbound && inbound.newThisWeek === 0) {
  inboundRows = `<tr><td>Inbound leads</td><td style="color:#888">No new leads this week</td></tr>`;
}

// ─── AR block ─────────────────────────────────────────────────────────────────

let arRows = '';
let hasOverdue = false;
if (ar) {
  hasOverdue = ar.overdue.length > 0;
  arRows = ar.overdue.length > 0
    ? ar.overdue
        .sort((a, b) => b.daysOverdue - a.daysOverdue)
        .map(i => `<tr>
          <td><strong>${i.contact}</strong></td>
          <td>${i.currency} ${i.amountDue} · due ${i.dueDate} · <strong style="color:${i.daysOverdue > 30 ? '#dc2626' : '#d97706'}">${i.daysOverdue}d overdue</strong></td>
        </tr>`).join('')
    : `<tr><td colspan="2" style="color:#16a34a">✓ No overdue invoices</td></tr>`;
}

// ─── Determine what Charlene must add ────────────────────────────────────────

const needsChaseInput = hasOverdue || (stripe?.failedPayments > 0);
const needsGTMInput = pipeline && (pipeline.staleDeals.length > 0 || pipeline.overdueNextSteps.length > 0);
const hasNumbers = stripeRows || pipelineRows || inboundRows;
const sourcesUsed = [
  stripe ? 'Stripe ✓' : null,
  pipeline ? 'Pipeline ✓' : null,
  inbound ? 'Airtable ✓' : null,
  ar ? 'Xero ✓' : null,
].filter(Boolean).join(' · ');

// ─── HTML ─────────────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #111; max-width: 620px; margin: 0 auto; padding: 24px; }
  h2 { font-size: 18px; font-weight: 900; margin-bottom: 4px; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #555; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td { padding: 5px 8px; border-bottom: 1px solid #f4f4f4; vertical-align: top; }
  td:first-child { color: #888; width: 36%; }
  .fill-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #aaa; margin: 14px 0 4px; }
  .fill-box { background: #f9f9f9; border: 1.5px dashed #d5d5d5; border-radius: 5px; padding: 10px 14px; font-size: 12px; color: #bbb; line-height: 1.8; }
  .footer { border-top: 1px solid #eee; padding-top: 10px; font-size: 10px; color: #aaa; margin-top: 24px; }
</style></head><body>

<h2>📋 EOW Report — ${dateLabel}</h2>
<p style="color:#555;margin-bottom:20px">Hi Charlene — all numbers below are auto-pulled from your tools. Add your notes in the dashed boxes, then <strong>reply to this email or forward to info@contentdash.app by 5pm.</strong></p>

${hasNumbers ? `
<div class="section">
  <div class="section-title">📊 This Week's Numbers</div>
  <table><tbody>
    ${stripeRows}
    ${pipelineRows}
    ${inboundRows}
  </tbody></table>
</div>` : ''}

${arRows ? `
<div class="section">
  <div class="section-title">${hasOverdue ? '🔴 Outstanding Invoices' : '📋 Invoices'}</div>
  <table><tbody>${arRows}</tbody></table>
  ${hasOverdue ? '<p style="font-size:11px;color:#666;margin-top:8px">For each overdue invoice: call or email the contact → log the outcome in Trello → set a follow-up if no response within 2 days.</p>' : ''}
</div>` : ''}

<div class="section">
  <div class="section-title">✍ Add Your Updates — Then Forward</div>

  <div class="fill-label">Hours Logged This Week (Clockify)</div>
  <div class="fill-box">[ Open Clockify → Reports → This Week → paste your total hours here ]</div>

  ${needsGTMInput ? `
  <div class="fill-label">GTM Actions — What Did You Do on Flagged Deals?</div>
  <div class="fill-box">[ For each stale/overdue deal above, note: email sent? call had? response received? ]</div>` : `
  <div class="fill-label">GTM Update</div>
  <div class="fill-box">[ Outreach sent, calls had, proposals shared, any pipeline movement this week ]</div>`}

  ${needsChaseInput ? `
  <div class="fill-label">Invoice / Payment Chases — What Did You Do?</div>
  <div class="fill-box">[ For each item flagged above: note the action taken, response received, and next step ]</div>` : ''}

  <div class="fill-label">Key Wins / Blockers for Ms. Fleire</div>
  <div class="fill-box">[ Anything significant the numbers don't capture — wins, blockers, decisions needed, escalations ]</div>

  <div class="fill-label">Next Week Priorities (Top 3–5)</div>
  <div class="fill-box">1.<br>2.<br>3.</div>
</div>

<p style="font-size:12px;color:#888">→ Fill in the boxes above and reply-all or forward to <strong>info@contentdash.app</strong> before 5pm today.</p>
<div class="footer">Auto-generated · dasho-ops · Fires every Friday 4pm PHT · ${sourcesUsed || 'No live sources connected'}</div>
</body></html>`;

// ─── Save ─────────────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `eow-reminder-${new Date().toISOString().slice(0, 10)}.html`), html);
console.log('✓ EOW reminder report saved to output/');

// ─── Email ────────────────────────────────────────────────────────────────────

const appPassword = process.env.GMAIL_APP_PASSWORD;
if (appPassword) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: appPassword },
  });
  const to = testing ? process.env.EMAIL_FLEIRE : process.env.EMAIL_CHARLENE;
  const cc = testing ? undefined : process.env.EMAIL_FLEIRE;
  await transporter.sendMail({
    from: `"DashoContent Ops" <${process.env.GMAIL_USER}>`,
    to, cc,
    subject: `${testing ? '[TEST] ' : ''}EOW Report Draft — ${dateLabel}`,
    html,
  });
  console.log(`✓ EOW email sent to ${to}${testing ? ' (TESTING MODE)' : ''}`);
} else {
  console.log('⚠ GMAIL_APP_PASSWORD not set');
}

// ─── Slack ────────────────────────────────────────────────────────────────────

const webhookUrl = process.env.SLACK_WEBHOOK_URL;
if (webhookUrl) {
  const mrrLine = stripe
    ? `*$${stripe.totalMRR}* MRR · ${stripe.subscriberCount} subs · Collected: $${stripe.collectedLast30Days}${stripe.failedPayments > 0 ? `\n⚠ ${stripe.failedPayments} failed payment — chase needed` : ''}`
    : null;

  const pipelineLine = pipeline
    ? `*${pipeline.totalDeals}* active deals · $${pipeline.totalPipelineValue.toLocaleString()} pipeline${pipeline.wonThisWeek > 0 ? `\n🏆 Won this week: ${pipeline.wonThisWeekDetails.map(d => d.account).join(', ')}` : ''}${pipeline.staleDeals.length > 0 ? `\n🟡 ${pipeline.staleDeals.length} deals need contact` : ''}`
    : null;

  const arLine = ar
    ? (ar.overdue.length === 0
        ? '✅ No overdue invoices'
        : ar.overdue.slice(0, 4).map(i => `• *${i.contact}* — ${i.currency} ${i.amountDue} · ${i.daysOverdue}d overdue`).join('\n')
          + (ar.overdue.length > 4 ? `\n_…and ${ar.overdue.length - 4} more_` : ''))
    : null;

  const inboundLine = inbound?.newThisWeek > 0
    ? `${inbound.newThisWeek} new inbound lead${inbound.newThisWeek !== 1 ? 's' : ''} in Airtable`
    : null;

  const fields = [
    mrrLine ? { type: 'mrkdwn', text: `💳 *Revenue*\n${mrrLine}` } : null,
    pipelineLine ? { type: 'mrkdwn', text: `📈 *Pipeline*\n${pipelineLine}` } : null,
    arLine ? { type: 'mrkdwn', text: `📋 *AR*\n${arLine}` } : null,
    inboundLine ? { type: 'mrkdwn', text: `📥 *Inbound*\n${inboundLine}` } : null,
  ].filter(Boolean);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📋 EOW Report Due Today — ${dateLabel}${testing ? ' [TEST]' : ''}` } },
    ...(fields.length > 0 ? [{ type: 'section', fields: fields.slice(0, 4) }] : []),
    { type: 'section', text: { type: 'mrkdwn', text: `EOW report draft has been emailed. Charlene — fill in your hours, actions, and notes, then forward to *info@contentdash.app* by 5pm.` } },
  ];

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  console.log('✓ EOW Slack sent');
}
