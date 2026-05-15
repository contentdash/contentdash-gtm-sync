import 'dotenv/config';
import nodemailer from 'nodemailer';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getStripeSnapshot } from './stripe-report.js';
import { getGTMSnapshot } from './gtm-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MRR_HISTORY_PATH = path.join(__dirname, 'mrr-history.json');
const MRR_MILESTONES = [500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000];

// ─── MRR History ──────────────────────────────────────────────────────────────

function readMRRHistory() {
  try { return JSON.parse(readFileSync(MRR_HISTORY_PATH, 'utf8')); }
  catch { return []; }
}

function writeMRRHistory(history, stripe) {
  const entry = {
    date: stripe.asOf,
    mrr: stripe.totalMRR,
    subscribers: stripe.subscriberCount,
    newSubs: stripe.growth.newSubs,
    churnedSubs: stripe.growth.churnedSubs,
    netMRRChange: stripe.growth.netMRRChange,
  };
  const filtered = history.filter(h => h.date !== entry.date);
  filtered.push(entry);
  filtered.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = filtered.slice(-52); // keep 1 year
  writeFileSync(MRR_HISTORY_PATH, JSON.stringify(trimmed, null, 2));
  return trimmed;
}

function getMRRTrend(history, currentMRR) {
  if (history.length < 2) return null;
  const prev = history[history.length - 2];
  const fourWeeksAgo = history.length >= 5 ? history[history.length - 5] : null;
  return {
    vsLastWeek: +(currentMRR - prev.mrr).toFixed(2),
    vsLastWeekPct: prev.mrr > 0 ? +(((currentMRR - prev.mrr) / prev.mrr) * 100).toFixed(1) : 0,
    vsFourWeeks: fourWeeksAgo ? +(currentMRR - fourWeeksAgo.mrr).toFixed(2) : null,
    prevMRR: prev.mrr,
  };
}

function detectMilestone(history, currentMRR) {
  if (history.length < 2) return null;
  const prevMRR = history[history.length - 2].mrr;
  const crossed = MRR_MILESTONES.find(m => prevMRR < m && currentMRR >= m);
  return crossed || null;
}

// ─── Xero Token Health ────────────────────────────────────────────────────────

function checkXeroTokenAge() {
  const tokensJson = process.env.XERO_TOKENS_JSON;
  if (!tokensJson) return null;
  try {
    const tokens = JSON.parse(tokensJson);
    if (!tokens.savedAt) return null;
    const daysSince = Math.floor((Date.now() - new Date(tokens.savedAt)) / 86400000);
    return { daysSince, daysLeft: 60 - daysSince, savedAt: tokens.savedAt };
  } catch { return null; }
}

// ─── Report Builder ───────────────────────────────────────────────────────────

async function buildReport() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const mrrHistory = readMRRHistory();

  // ── Stripe ──
  let stripe = null;
  let stripeSection = '';
  let mrrTrend = null;
  let milestone = null;
  try {
    stripe = await getStripeSnapshot();
    mrrTrend = getMRRTrend(mrrHistory, stripe.totalMRR);
    milestone = detectMilestone(mrrHistory, stripe.totalMRR);

    const subRows = stripe.subscriptions.map(s => `
      <tr>
        <td>${s.customerName}</td>
        <td>${s.currency} ${(s.amount / 100).toFixed(2)}/${s.interval}</td>
        <td>~$${s.monthlyUSD}/mo</td>
        <td>${s.currentPeriodEnd}</td>
      </tr>`).join('');

    const netMRRColor = stripe.growth.netMRRChange >= 0 ? '#16a34a' : '#dc2626';
    const netSign = stripe.growth.netMRRChange >= 0 ? '+' : '';

    let trendHtml = '';
    if (mrrTrend) {
      const wColor = mrrTrend.vsLastWeek >= 0 ? '#16a34a' : '#dc2626';
      const wSign = mrrTrend.vsLastWeek >= 0 ? '+' : '';
      trendHtml = `<div class="kpi-sub" style="color:${wColor}">${wSign}$${mrrTrend.vsLastWeek} vs last week (${wSign}${mrrTrend.vsLastWeekPct}%)`;
      if (mrrTrend.vsFourWeeks !== null) {
        const mSign = mrrTrend.vsFourWeeks >= 0 ? '+' : '';
        trendHtml += ` · ${mSign}$${mrrTrend.vsFourWeeks} vs 4 wks ago`;
      }
      trendHtml += '</div>';
    }

    stripeSection = `
      <div class="section">
        <div class="section-title">💳 Stripe — Platform MRR</div>
        <div class="kpi-row">
          <div class="kpi">
            <div class="kpi-label">Total MRR</div>
            <div class="kpi-val" style="color:#16a34a">$${stripe.totalMRR}</div>
            <div class="kpi-sub">${stripe.subscriberCount} subscribers (USD equiv.)</div>
            ${trendHtml}
          </div>
          <div class="kpi">
            <div class="kpi-label">Net MRR Change</div>
            <div class="kpi-val" style="color:${netMRRColor}">${netSign}$${stripe.growth.netMRRChange}</div>
            <div class="kpi-sub">+${stripe.growth.newSubs} new · −${stripe.growth.churnedSubs} churned (30d)</div>
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
        ${stripe.growth.newSubDetails.length ? `
        <p style="font-size:11px;color:#16a34a;font-weight:600;margin-bottom:4px">🎉 New subscribers this period: ${stripe.growth.newSubDetails.map(s => `${s.customer} (~$${s.monthlyUSD}/mo)`).join(' · ')}</p>` : ''}
        <table>
          <thead><tr><th>Subscriber</th><th>Plan</th><th>MRR equiv.</th><th>Next billing</th></tr></thead>
          <tbody>${subRows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    stripeSection = `<div class="section"><div class="section-title">💳 Stripe</div><p style="color:#dc2626">Error: ${e.message}</p></div>`;
  }

  // ── GTM Pipeline ──
  let gtm = null;
  let gtmSection = '';
  try {
    gtm = await getGTMSnapshot();
    const p = gtm.pipeline;
    const ib = gtm.inbound;

    if (p) {
      const stageOrder = ['ICP Fit', 'Outreach Sent', 'Replied', 'Qualification Booked', 'Qualified',
        'Discovery Booked', 'Discovery Done', 'Proposal Sent', 'Negotiation'];
      const allStages = [...new Set([...stageOrder, ...Object.keys(p.stageCounts)])];
      const stageRows = allStages
        .filter(s => p.stageCounts[s])
        .map(s => `<tr><td>${s}</td><td>${p.stageCounts[s]}</td><td>${p.stageValues[s] ? '$' + p.stageValues[s].toLocaleString() : '—'}</td></tr>`)
        .join('');

      let alertRows = '';
      if (p.overdueNextSteps.length) {
        alertRows += p.overdueNextSteps.slice(0, 5).map(d =>
          `<tr style="background:#fff5f5"><td>🔴 Overdue</td><td><strong>${d.account}</strong> · ${d.stage}</td><td>${d.nextStep || 'Next step overdue'} · was ${d.nextStepDate || '—'}</td></tr>`
        ).join('');
      }
      if (p.stuckDeals.length) {
        alertRows += p.stuckDeals.slice(0, 3).map(d =>
          `<tr style="background:#fff5f5"><td>🔴 Stuck</td><td><strong>${d.account}</strong> · ${d.stage}</td><td>${d.daysSince} days no movement</td></tr>`
        ).join('');
      }
      if (p.staleDeals.length) {
        alertRows += p.staleDeals.slice(0, 5).map(d =>
          `<tr style="background:#fffbeb"><td>🟡 Stale</td><td><strong>${d.account}</strong> · ${d.stage}</td><td>${d.daysSince} days no contact</td></tr>`
        ).join('');
      }
      if (!alertRows) alertRows = '<tr><td colspan="3" style="color:#16a34a;text-align:center">✓ No urgent pipeline alerts</td></tr>';

      const inboundNote = ib ? `${ib.newThisWeek} new this week` : '—';

      gtmSection = `
        <div class="section">
          <div class="section-title">📈 GTM — Pipeline & Inbound</div>
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
              <div class="kpi-label">Proposal Conv.</div>
              <div class="kpi-val" style="color:${p.proposalConvRate >= 20 ? '#16a34a' : p.proposalConvRate >= 10 ? '#d97706' : '#dc2626'}">${p.proposalConvRate}%</div>
              <div class="kpi-sub">Leads → Proposal+</div>
            </div>
            <div class="kpi">
              <div class="kpi-label">Inbound Leads</div>
              <div class="kpi-val">${ib ? ib.total : '—'}</div>
              <div class="kpi-sub">${inboundNote}</div>
            </div>
            <div class="kpi">
              <div class="kpi-label">Health</div>
              <div class="kpi-val" style="font-size:14px">🔴${p.health.red} 🟡${p.health.yellow} 🟢${p.health.green}</div>
              <div class="kpi-sub">Won this week: ${p.wonThisWeek}${p.wonThisWeekDetails.length ? ' — ' + p.wonThisWeekDetails.map(d => d.account).join(', ') : ''}</div>
            </div>
          </div>
          <table style="margin-bottom:12px">
            <thead><tr><th>Stage</th><th>Deals</th><th>Value</th></tr></thead>
            <tbody>${stageRows}</tbody>
          </table>
          <div style="font-size:11px;margin-bottom:12px">
            <strong>Funnel:</strong> ${p.funnel.map(f => `${f.stage} (${f.count})`).join(' → ')}
          </div>
          <div class="section-title" style="margin-top:12px">⚠ Pipeline Alerts</div>
          <table>
            <thead><tr><th>Status</th><th>Deal</th><th>Issue</th></tr></thead>
            <tbody>${alertRows}</tbody>
          </table>
          ${ib?.recent?.length ? `
          <div class="section-title" style="margin-top:12px">📥 New Inbound Leads This Week</div>
          <table>
            <thead><tr><th>Company</th><th>Email</th><th>Date</th></tr></thead>
            <tbody>${ib.recent.map(l => `<tr><td>${l.account}</td><td>${l.email}</td><td>${l.createdAt}</td></tr>`).join('')}</tbody>
          </table>` : ''}
        </div>`;
    } else {
      gtmSection = '';
    }
  } catch (e) {
    gtmSection = '';
  }

  // ── Xero AR ──
  let ar = null;
  let arSection = '';
  const xeroTokenAge = checkXeroTokenAge();
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

    const tokenWarning = xeroTokenAge && xeroTokenAge.daysLeft <= 7
      ? `<p style="color:#dc2626;font-size:12px;font-weight:600">⚠ Xero token expires in ${xeroTokenAge.daysLeft} day${xeroTokenAge.daysLeft !== 1 ? 's' : ''} — re-auth now: <code>cd ~/Projects/xero-datapull && npm run auth</code></p>`
      : xeroTokenAge && xeroTokenAge.daysLeft <= 14
      ? `<p style="color:#d97706;font-size:12px">⚠ Xero token expires in ${xeroTokenAge.daysLeft} days — schedule re-auth soon</p>`
      : '';

    arSection = `
      <div class="section">
        <div class="section-title">📋 Xero — Accounts Receivable</div>
        ${tokenWarning}
        <p style="font-size:12px;color:#666;margin-bottom:8px">Total open AR: <strong>${ar.totalAR.toFixed(2)}</strong> | Overdue: <strong>${ar.overdue.length} invoices</strong></p>
        <table>
          <thead><tr><th>Client</th><th>Amount Due</th><th>Due Date</th><th>Days Overdue</th><th>Status</th></tr></thead>
          <tbody>${overdueRows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    arSection = ''; // Xero unavailable — token expiry warning surfaces in action items if applicable
  }

  // ── Action Items (auto-generated from real data) ──
  const actionRows = [];

  if (stripe?.failedPayments > 0) {
    (stripe.failedDetails || []).forEach(f => {
      actionRows.push(`<tr style="background:#fff5f5"><td>🔴 Urgent</td><td>Failed payment — <strong>${f.customer}</strong> · ${f.amount} · failed ${f.date} · contact to update card</td><td>Charlene</td></tr>`);
    });
  }

  if (ar?.overdue?.length > 0) {
    const sorted = [...ar.overdue].sort((a, b) => b.daysOverdue - a.daysOverdue);
    sorted.forEach(i => {
      const urgency = i.daysOverdue > 30 ? '🔴 Urgent' : i.daysOverdue > 14 ? '🔴 High' : '🟡 Med';
      const bg = i.daysOverdue > 14 ? 'background:#fff5f5' : '';
      actionRows.push(`<tr style="${bg}"><td>${urgency}</td><td>Chase <strong>${i.contact}</strong> — ${i.currency} ${i.amountDue} due ${i.dueDate} · <strong>${i.daysOverdue} days overdue</strong></td><td>Charlene</td></tr>`);
    });
  }

  if (gtm?.pipeline) {
    const p = gtm.pipeline;
    p.overdueNextSteps.slice(0, 3).forEach(d => {
      actionRows.push(`<tr style="background:#fff5f5"><td>🔴 Urgent</td><td>Overdue next step — <strong>${d.account}</strong> · ${d.stage}: ${d.nextStep || 'follow up'} (was ${d.nextStepDate || 'past due'})</td><td>Charlene</td></tr>`);
    });
    p.stuckDeals.slice(0, 3).forEach(d => {
      actionRows.push(`<tr style="background:#fff5f5"><td>🔴 High</td><td>Stuck deal — <strong>${d.account}</strong> · ${d.stage} · ${d.daysSince} days no movement — escalate to Fleire</td><td>Charlene</td></tr>`);
    });
    p.staleDeals.slice(0, 3).forEach(d => {
      actionRows.push(`<tr style="background:#fffbeb"><td>🟡 Med</td><td>No contact in ${d.daysSince} days — <strong>${d.account}</strong> · ${d.stage} — send check-in</td><td>Charlene</td></tr>`);
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
    actionRows.push(`<tr><td>🟡 Med</td><td>Confirm renewal — <strong>${s.customerName}</strong> ${s.currency} ${(s.amount / 100).toFixed(2)} renewing ${s.currentPeriodEnd}</td><td>Charlene</td></tr>`);
  });

  if (xeroTokenAge && xeroTokenAge.daysLeft <= 14) {
    actionRows.push(`<tr style="background:#fff5f5"><td>🔴 Urgent</td><td>Xero token expires in <strong>${xeroTokenAge.daysLeft} days</strong> — re-auth: <code>cd ~/Projects/xero-datapull && npm run auth</code> then update XERO_TOKENS_JSON secret</td><td>Fleire</td></tr>`);
  }

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

  const milestoneBar = milestone
    ? `<div style="background:#16a34a;color:#fff;text-align:center;padding:12px;border-radius:6px;margin-bottom:20px;font-weight:900;font-size:16px">🎉 MRR MILESTONE: $${milestone.toLocaleString()} USD! Keep pushing!</div>`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #111; max-width: 740px; margin: 0 auto; padding: 24px; }
  .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header h1 { font-size: 20px; font-weight: 900; margin: 0; }
  .header .meta { font-size: 11px; color: #888; text-align: right; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #555; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 12px; }
  .kpi-row { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .kpi { flex: 1; min-width: 120px; background: #f8f8f8; border-radius: 6px; padding: 10px 14px; }
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
  <div class="meta">Auto-generated<br>info@contentdash.app</div>
</div>
${milestoneBar}
${stripeSection}
${gtmSection}
${arSection}
${actionSection}
<div class="footer">
  Auto-generated by dasho-ops · DashoContent · ContentDash PTE LTD<br>
  Runs every Monday at 8am PHT · Source: Stripe API + Xero API + Google Sheets + Airtable
</div>
</body></html>`;

  return { html, stripe, ar, gtm, mrrTrend, milestone, mrrHistory };
}

// ─── Slack ────────────────────────────────────────────────────────────────────

async function sendSlack(stripe, ar, gtm, mrrTrend, milestone, xeroTokenAge) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) { console.log('⚠ SLACK_WEBHOOK_URL not set — skipping Slack'); return; }

  const testing = process.env.TESTING_MODE !== 'false';
  const dateLabel = new Date().toLocaleDateString('en-SG', { weekday: 'long', month: 'short', day: 'numeric' });

  // Build blocks
  const blocks = [];

  // Header
  blocks.push({ type: 'header', text: { type: 'plain_text', text: `📊 DashoContent Weekly Ops${testing ? ' [TEST]' : ''} — ${dateLabel}` } });

  // MRR milestone celebration — top of message
  if (milestone) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `🎉 *MRR MILESTONE HIT: $${milestone.toLocaleString()}!* Keep pushing, team! 🚀` } });
  }

  // New subscriber celebration
  if (stripe?.growth?.newSubDetails?.length > 0) {
    const names = stripe.growth.newSubDetails.map(s => `*${s.customer}* (~$${s.monthlyUSD}/mo)`).join(', ');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `🎉 *New subscriber${stripe.growth.newSubDetails.length > 1 ? 's' : ''} this period:* ${names}` } });
  }

  // Won deal celebration
  if (gtm?.pipeline?.wonThisWeek > 0) {
    const wonNames = gtm.pipeline.wonThisWeekDetails.map(d => `*${d.account}*`).join(', ');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `🏆 *Deal${gtm.pipeline.wonThisWeek > 1 ? 's' : ''} closed this week:* ${wonNames || `${gtm.pipeline.wonThisWeek} won`}` } });
  }

  // Clean week celebration
  const isCleanWeek = stripe && stripe.failedPayments === 0 && (!ar || ar.overdue.length === 0);
  if (isCleanWeek) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '✅ *Clean week!* No failed payments. No overdue invoices. All good.' } });
  }

  // Stripe + MRR trend
  let mrrText = stripe
    ? `*$${stripe.totalMRR}* MRR · ${stripe.subscriberCount} subs`
    : '_Stripe unavailable_';
  if (mrrTrend) {
    const sign = mrrTrend.vsLastWeek >= 0 ? '+' : '';
    mrrText += `\n${sign}$${mrrTrend.vsLastWeek} vs last wk (${sign}${mrrTrend.vsLastWeekPct}%)`;
  }
  if (stripe) {
    const netSign = stripe.growth.netMRRChange >= 0 ? '+' : '';
    mrrText += `\nNet MRR change: ${netSign}$${stripe.growth.netMRRChange} · Collected: $${stripe.collectedLast30Days}`;
  }
  if (stripe?.failedPayments > 0) {
    mrrText += '\n⚠ *Failed:* ' + (stripe.failedDetails?.map(f => `${f.customer} (${f.amount})`).join(', ') || `${stripe.failedPayments} payment(s)`);
  }

  // GTM
  let gtmText = null;
  if (gtm?.pipeline) {
    const p = gtm.pipeline;
    const alerts = p.overdueNextSteps.length + p.stuckDeals.length;
    gtmText = `*${p.totalDeals}* active deals · $${p.totalPipelineValue.toLocaleString()} pipeline`;
    gtmText += `\nConversion: *${p.proposalConvRate}%* to Proposal+`;
    gtmText += `\n🔴${p.health.red} 🟡${p.health.yellow} 🟢${p.health.green} · ${alerts > 0 ? `⚠ ${alerts} alert${alerts !== 1 ? 's' : ''}` : '✅ no alerts'}`;
    if (gtm.inbound?.newThisWeek > 0) gtmText += `\n${gtm.inbound.newThisWeek} new inbound lead${gtm.inbound.newThisWeek !== 1 ? 's' : ''}`;
  }

  // AR
  let arText = null;
  if (ar) {
    arText = ar.overdue.length === 0
      ? '✅ No overdue invoices'
      : ar.overdue.slice(0, 5).map(i => `• *${i.contact}* — ${i.currency} ${i.amountDue} · ${i.daysOverdue}d overdue`).join('\n')
        + (ar.overdue.length > 5 ? `\n_…and ${ar.overdue.length - 5} more_` : '');
  }

  const mainFields = [
    { type: 'mrkdwn', text: `💳 *Stripe*\n${mrrText}` },
    gtmText ? { type: 'mrkdwn', text: `📈 *GTM Pipeline*\n${gtmText}` } : null,
  ].filter(Boolean);
  blocks.push({ type: 'section', fields: mainFields });

  if (arText) {
    blocks.push({ type: 'section', fields: [{ type: 'mrkdwn', text: `📋 *Overdue AR*\n${arText}` }] });
  }

  // Xero token expiry warning
  if (xeroTokenAge && xeroTokenAge.daysLeft <= 14) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `🔐 *Xero token expires in ${xeroTokenAge.daysLeft} day${xeroTokenAge.daysLeft !== 1 ? 's' : ''}* — re-auth before next digest or AR data will break` } });
  }

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Full report emailed · ${dateLabel}` }] });

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  console.log('✓ Slack notification sent');
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(html) {
  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!appPassword) {
    console.log('⚠ GMAIL_APP_PASSWORD not set — skipping email');
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: appPassword },
  });

  const now = new Date();
  const subject = `DashoContent Ops Digest — Week of ${now.toLocaleDateString('en-SG', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const testing = process.env.TESTING_MODE !== 'false';
  const recipients = process.env.EMAIL_FLEIRE;

  await transporter.sendMail({
    from: `"DashoContent Ops" <${process.env.GMAIL_USER}>`,
    to: recipients,
    subject: testing ? `[TEST] ${subject}` : subject,
    html,
  });
  console.log(`✓ Email sent to ${recipients}${testing ? ' (TESTING MODE)' : ''}`);
  return true;
}

// ─── Google Drive sync ────────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

const { html, stripe, ar, gtm, mrrTrend, milestone, mrrHistory } = await buildReport();

// Save HTML report
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `digest-${new Date().toISOString().slice(0, 10)}.html`);
writeFileSync(outPath, html);
console.log(`✓ Report saved: ${outPath}`);

// Update MRR history
if (stripe) {
  writeMRRHistory(mrrHistory, stripe);
  console.log(`✓ MRR history updated (${mrrHistory.length + 1} entries)`);
}

const xeroTokenAge = checkXeroTokenAge();

await Promise.all([
  sendEmail(html),
  sendSlack(stripe, ar, gtm, mrrTrend, milestone, xeroTokenAge),
]);

syncToDrive(outPath);
