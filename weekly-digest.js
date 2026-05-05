import 'dotenv/config';
import nodemailer from 'nodemailer';
import { getStripeSnapshot } from './stripe-report.js';
import { getGTMSnapshot } from './gtm-report.js';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function statusColor(val, warn, bad) {
  if (val >= warn) return '#dc2626';
  if (val >= bad) return '#d97706';
  return '#16a34a';
}

async function buildReport() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // --- Stripe data (always available) ---
  let stripe = null;
  let ar = null;
  let stripeSection = '';
  try {
    stripe = await getStripeSnapshot();
    const subRows = stripe.subscriptions.map(s => `
      <tr>
        <td>${s.customerName}</td>
        <td>${s.currency} ${(s.amount/100).toFixed(2)}/${s.interval}</td>
        <td>~$${s.monthlyUSD}/mo</td>
        <td>${s.currentPeriodEnd}</td>
      </tr>`).join('');

    const netMRRColor = stripe.growth.netMRRChange >= 0 ? '#16a34a' : '#dc2626';
    const netMRRSign = stripe.growth.netMRRChange >= 0 ? '+' : '';
    stripeSection = `
      <div class="section">
        <div class="section-title">💳 Stripe — Platform MRR</div>
        <div class="kpi-row">
          <div class="kpi">
            <div class="kpi-label">Total MRR</div>
            <div class="kpi-val" style="color:#16a34a">$${stripe.totalMRR}</div>
            <div class="kpi-sub">${stripe.subscriberCount} subscribers</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Net MRR Change</div>
            <div class="kpi-val" style="color:${netMRRColor}">${netMRRSign}$${stripe.growth.netMRRChange}</div>
            <div class="kpi-sub">+${stripe.growth.newSubs} new · −${stripe.growth.churnedSubs} churned</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Collected (30d)</div>
            <div class="kpi-val">$${stripe.collectedLast30Days}</div>
            <div class="kpi-sub">USD via Stripe</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Failed Payments</div>
            <div class="kpi-val" style="color:${stripe.failedPayments > 0 ? '#dc2626' : '#16a34a'}">${stripe.failedPayments}</div>
            <div class="kpi-sub">Last 30 days</div>
          </div>
        </div>
        <table>
          <thead><tr><th>Subscriber</th><th>Plan</th><th>MRR equiv.</th><th>Next billing</th></tr></thead>
          <tbody>${subRows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    stripeSection = `<div class="section"><div class="section-title">💳 Stripe</div><p style="color:#dc2626">Error: ${e.message}</p></div>`;
  }

  // --- GTM pipeline snapshot ---
  let gtm = null;
  let gtmSection = '';
  try {
    gtm = await getGTMSnapshot();
    const p = gtm.pipeline;
    const ib = gtm.inbound;

    let stageRows = '';
    if (p) {
      const stageOrder = ['ICP Fit', 'Outreach Sent', 'Replied', 'Qualification Booked', 'Qualified', 'Discovery Booked', 'Discovery Done', 'Proposal Sent', 'Negotiation'];
      const allStages = [...new Set([...stageOrder, ...Object.keys(p.stageCounts)])];
      stageRows = allStages
        .filter(s => p.stageCounts[s])
        .map(s => `<tr><td>${s}</td><td>${p.stageCounts[s]}</td><td>${p.stageValues[s] ? '$' + p.stageValues[s].toLocaleString() : '—'}</td></tr>`)
        .join('');
    }

    let alertRows = '';
    if (p?.staleDeals?.length) {
      alertRows += p.staleDeals.slice(0, 5).map(d =>
        `<tr style="background:#fffbeb"><td>🟡 Stale</td><td><strong>${d.account}</strong> · ${d.stage}</td><td>${d.daysSince} days no contact</td></tr>`
      ).join('');
    }
    if (p?.overdueNextSteps?.length) {
      alertRows += p.overdueNextSteps.slice(0, 5).map(d =>
        `<tr style="background:#fff5f5"><td>🔴 Overdue</td><td><strong>${d.account}</strong> · ${d.stage}</td><td>${d.nextStep || 'Next step overdue'} (${d.nextStepDate || '—'})</td></tr>`
      ).join('');
    }
    if (p?.stuckDeals?.length) {
      alertRows += p.stuckDeals.slice(0, 3).map(d =>
        `<tr style="background:#fff5f5"><td>🔴 Stuck</td><td><strong>${d.account}</strong> · ${d.stage}</td><td>${d.daysSince} days no movement</td></tr>`
      ).join('');
    }
    if (!alertRows) alertRows = '<tr><td colspan="3" style="color:#16a34a;text-align:center">✓ No urgent pipeline alerts</td></tr>';

    const inboundNote = ib ? `${ib.newThisWeek} new lead${ib.newThisWeek !== 1 ? 's' : ''} this week` : 'Airtable unavailable';

    gtmSection = `
      <div class="section">
        <div class="section-title">📈 GTM — Pipeline & Inbound</div>
        ${p ? `
        <div class="kpi-row">
          <div class="kpi">
            <div class="kpi-label">Active Deals</div>
            <div class="kpi-val">${p.totalDeals}</div>
            <div class="kpi-sub">+${p.newThisWeek} new this week</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Pipeline Value</div>
            <div class="kpi-val">$${p.totalPipelineValue.toLocaleString()}</div>
            <div class="kpi-sub">Active stages</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Inbound Leads</div>
            <div class="kpi-val">${ib ? ib.total : '—'}</div>
            <div class="kpi-sub">${inboundNote}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Health</div>
            <div class="kpi-val" style="font-size:14px">🔴${p.health.red} 🟡${p.health.yellow} 🟢${p.health.green}</div>
            <div class="kpi-sub">Won this week: ${p.wonThisWeek}</div>
          </div>
        </div>
        <table style="margin-bottom:12px">
          <thead><tr><th>Stage</th><th>Deals</th><th>Value</th></tr></thead>
          <tbody>${stageRows}</tbody>
        </table>
        <div class="section-title" style="margin-top:12px">⚠ Pipeline Alerts</div>
        <table>
          <thead><tr><th>Status</th><th>Deal</th><th>Issue</th></tr></thead>
          <tbody>${alertRows}</tbody>
        </table>` : `<p style="color:#d97706">⚠ Pipeline data unavailable — set APPS_SCRIPT_URL + APPS_SCRIPT_TOKEN</p>`}
      </div>`;
  } catch (e) {
    gtmSection = `<div class="section"><div class="section-title">📈 GTM</div><p style="color:#dc2626">Error: ${e.message}</p></div>`;
  }

  // --- Xero AR (optional — needs auth) ---
  let arSection = '';
  try {
    const { getARSnapshot } = await import('./ar-check.js');
    ar = await getARSnapshot();
    const overdueRows = ar.overdue.length
      ? ar.overdue.map(i => `
        <tr>
          <td>${i.contact}</td>
          <td>${i.currency} ${i.amountDue}</td>
          <td>${i.dueDate}</td>
          <td><strong style="color:${i.daysOverdue > 30 ? '#dc2626' : '#d97706'}">${i.daysOverdue} days</strong></td>
          <td>${i.status}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="color:#16a34a; text-align:center">✓ No overdue invoices</td></tr>';

    arSection = `
      <div class="section">
        <div class="section-title">📋 Xero — Accounts Receivable</div>
        <p style="font-size:12px;color:#666;margin-bottom:8px">Total open AR: <strong>${ar.totalAR.toFixed(2)}</strong> | Overdue: <strong>${ar.overdue.length} invoices</strong></p>
        <table>
          <thead><tr><th>Client</th><th>Amount Due</th><th>Due Date</th><th>Days Overdue</th><th>Status</th></tr></thead>
          <tbody>${overdueRows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    arSection = `
      <div class="section">
        <div class="section-title">📋 Xero — Accounts Receivable</div>
        <p style="color:#d97706;font-size:12px">⚠ Xero not connected. Run: <code>cd ~/Projects/xero-datapull && npm run auth</code></p>
      </div>`;
  }

  // --- Action items — dynamically generated from real data ---
  const actionRows = [];

  if (stripe?.failedPayments > 0) {
    (stripe.failedDetails || []).forEach(f => {
      actionRows.push(`<tr style="background:#fff5f5"><td>🔴 Urgent</td><td>Failed payment — <strong>${f.customer}</strong> · ${f.amount} · failed ${f.date} · contact to update card</td><td>Charlene</td></tr>`);
    });
    if (!stripe.failedDetails?.length) {
      actionRows.push(`<tr style="background:#fff5f5"><td>🔴 Urgent</td><td>Fix ${stripe.failedPayments} failed Stripe payment(s) — check Stripe dashboard</td><td>Charlene</td></tr>`);
    }
  }

  if (ar?.overdue?.length > 0) {
    const sorted = [...ar.overdue].sort((a, b) => b.daysOverdue - a.daysOverdue);
    sorted.forEach(i => {
      const urgency = i.daysOverdue > 30 ? '🔴 Urgent' : i.daysOverdue > 14 ? '🔴 High' : '🟡 Med';
      const bg = i.daysOverdue > 14 ? 'background:#fff5f5' : '';
      actionRows.push(`<tr style="${bg}"><td>${urgency}</td><td>Chase <strong>${i.contact}</strong> — ${i.currency} ${i.amountDue} due ${i.dueDate} · <strong>${i.daysOverdue} days overdue</strong></td><td>Charlene</td></tr>`);
    });
  }

  // GTM action items
  if (gtm?.pipeline) {
    const p = gtm.pipeline;
    p.overdueNextSteps.slice(0, 3).forEach(d => {
      actionRows.push(`<tr style="background:#fff5f5"><td>🔴 Urgent</td><td>Overdue next step — <strong>${d.account}</strong> · ${d.stage}: ${d.nextStep || 'follow up'} (was ${d.nextStepDate || 'past due'})</td><td>Charlene</td></tr>`);
    });
    p.stuckDeals.slice(0, 3).forEach(d => {
      actionRows.push(`<tr style="background:#fff5f5"><td>🔴 Urgent</td><td>Stuck deal — <strong>${d.account}</strong> · ${d.stage} · ${d.daysSince} days no movement</td><td>Charlene</td></tr>`);
    });
    p.staleDeals.slice(0, 3).forEach(d => {
      actionRows.push(`<tr style="background:#fffbeb"><td>🟡 Med</td><td>No contact in ${d.daysSince} days — <strong>${d.account}</strong> · ${d.stage}</td><td>Charlene</td></tr>`);
    });
    if (gtm.inbound?.newThisWeek > 0) {
      actionRows.push(`<tr><td>🟡 Med</td><td>Review ${gtm.inbound.newThisWeek} new inbound lead${gtm.inbound.newThisWeek !== 1 ? 's' : ''} in Airtable — qualify and add to pipeline</td><td>Charlene</td></tr>`);
    }
  }

  const renewingThisWeek = stripe?.subscriptions.filter(s => {
    const days = Math.ceil((new Date(s.currentPeriodEnd) - new Date()) / 86400000);
    return days >= 0 && days <= 7;
  }) || [];
  renewingThisWeek.forEach(s => {
    actionRows.push(`<tr><td>🟡 Med</td><td>Confirm renewal — <strong>${s.customerName}</strong> ${s.currency} ${(s.amount/100).toFixed(2)} renewing ${s.currentPeriodEnd}</td><td>Charlene</td></tr>`);
  });

  actionRows.push(`<tr><td>🟢 Routine</td><td>Update GTM pipeline — flag stale leads with no activity in 5+ days</td><td>Charlene</td></tr>`);
  actionRows.push(`<tr><td>🟢 Routine</td><td>Prepare EOW report by Friday 4pm — send to info@contentdash.app</td><td>Charlene</td></tr>`);

  const actionSection = `
    <div class="section">
      <div class="section-title">✅ This Week's Action Items</div>
      <table>
        <thead><tr><th>Priority</th><th>Task</th><th>Owner</th></tr></thead>
        <tbody>${actionRows.join('')}</tbody>
      </table>
    </div>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #111; max-width: 700px; margin: 0 auto; padding: 24px; }
  .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header h1 { font-size: 20px; font-weight: 900; margin: 0; }
  .header .meta { font-size: 11px; color: #888; text-align: right; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #555; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 12px; }
  .kpi-row { display: flex; gap: 12px; margin-bottom: 14px; }
  .kpi { flex: 1; background: #f8f8f8; border-radius: 6px; padding: 10px 14px; }
  .kpi-label { font-size: 10px; color: #888; font-weight: 600; margin-bottom: 2px; }
  .kpi-val { font-size: 22px; font-weight: 900; line-height: 1.1; }
  .kpi-sub { font-size: 10px; color: #999; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #aaa; text-align: left; padding: 4px 8px; border-bottom: 1px solid #eee; }
  td { padding: 6px 8px; border-bottom: 1px solid #f4f4f4; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 11px; }
  .footer { border-top: 1px solid #eee; padding-top: 10px; font-size: 10px; color: #aaa; margin-top: 24px; }
</style>
</head><body>
<div class="header">
  <div><h1>DashoContent — Weekly Ops Digest</h1><div style="font-size:12px;color:#666;margin-top:2px">${dateStr}</div></div>
  <div class="meta">Auto-generated<br>info@contentdash.app · cvirlouvet@contentdash.app</div>
</div>
${stripeSection}
${gtmSection}
${arSection}
${actionSection}
<div class="footer">
  Auto-generated by dasho-ops · DashoContent · ContentDash PTE LTD<br>
  This report runs every Monday at 8am. Source: Stripe API + Xero API.
</div>
</body></html>`;

  return { html, stripe, ar, gtm };
}

async function sendSlack(stripe, ar, gtm) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) { console.log('⚠ SLACK_WEBHOOK_URL not set — skipping Slack'); return; }

  const mrrText = stripe
    ? `*$${stripe.totalMRR}* MRR · ${stripe.subscriberCount} subs · Net: ${stripe.growth.netMRRChange >= 0 ? '+' : ''}$${stripe.growth.netMRRChange}\n$${stripe.collectedLast30Days} collected (30d)`
    : '_Stripe unavailable_';
  const failedText = stripe?.failedPayments > 0
    ? '\n⚠ *Failed:* ' + (stripe.failedDetails?.map(f => `${f.customer} (${f.amount})`).join(', ') || `${stripe.failedPayments} payment(s)`)
    : '';

  let arLines = '_Xero not connected_';
  if (ar) {
    arLines = ar.overdue.length === 0
      ? '✅ No overdue invoices'
      : ar.overdue.slice(0, 5).map(i => `• *${i.contact}* — ${i.currency} ${i.amountDue} · ${i.daysOverdue}d overdue`).join('\n')
        + (ar.overdue.length > 5 ? `\n_…and ${ar.overdue.length - 5} more_` : '');
  }

  let gtmLines = '_Pipeline unavailable_';
  if (gtm?.pipeline) {
    const p = gtm.pipeline;
    const alerts = (p.overdueNextSteps.length + p.stuckDeals.length);
    gtmLines = `*${p.totalDeals}* active deals · $${p.totalPipelineValue.toLocaleString()} pipeline`;
    gtmLines += `\n🔴${p.health.red} 🟡${p.health.yellow} 🟢${p.health.green} health · ${alerts > 0 ? `⚠ ${alerts} alert${alerts !== 1 ? 's' : ''}` : '✅ no alerts'}`;
    if (gtm.inbound?.newThisWeek > 0) gtmLines += `\n${gtm.inbound.newThisWeek} new inbound lead${gtm.inbound.newThisWeek !== 1 ? 's' : ''} this week`;
  }

  const testing = process.env.TESTING_MODE !== 'false';

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `📊 DashoContent — Weekly Ops Digest${testing ? ' [TEST]' : ''}` } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: `💳 *Stripe*\n${mrrText}${failedText}` },
          { type: 'mrkdwn', text: `📈 *GTM Pipeline*\n${gtmLines}` },
        ]},
        { type: 'section', fields: [
          { type: 'mrkdwn', text: `📋 *Overdue AR*\n${arLines}` },
        ]},
        { type: 'context', elements: [{ type: 'mrkdwn', text: `Full report emailed · ${new Date().toLocaleDateString('en-SG', { weekday: 'long', month: 'short', day: 'numeric' })}` }]},
      ]
    }),
  });
  console.log('✓ Slack notification sent');
}

async function sendEmail(html) {
  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!appPassword) {
    console.log('⚠ GMAIL_APP_PASSWORD not set — skipping email send. Report saved to disk only.');
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: appPassword },
  });

  const now = new Date();
  const subject = `DashoContent Ops Digest — Week of ${now.toLocaleDateString('en-SG', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const testing = process.env.TESTING_MODE !== 'false';
  const recipients = testing ? process.env.EMAIL_FLEIRE : [process.env.EMAIL_FLEIRE, process.env.EMAIL_CHARLENE].join(', ');

  await transporter.sendMail({
    from: `"DashoContent Ops" <${process.env.GMAIL_USER}>`,
    to: recipients,
    subject: testing ? `[TEST] ${subject}` : subject,
    html,
  });

  console.log(`✓ Email sent to ${recipients}${testing ? ' (TESTING MODE)' : ''}`);
  return true;
}

function syncToDrive(filePath) {
  const drivePath = process.env.GDRIVE_PATH;
  if (!drivePath) return;
  try {
    mkdirSync(drivePath, { recursive: true });
    execSync(`cp "${filePath}" "${drivePath}/weekly-digest.html"`);
    console.log('✓ Synced to Google Drive');
  } catch (e) {
    console.log('⚠ Google Drive sync failed:', e.message);
  }
}

// Main
const { html, stripe, ar, gtm } = await buildReport();
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `digest-${new Date().toISOString().slice(0, 10)}.html`);
writeFileSync(outPath, html);
console.log(`✓ Report saved: ${outPath}`);

await Promise.all([
  sendEmail(html),
  sendSlack(stripe, ar, gtm),
]);
syncToDrive(outPath);
