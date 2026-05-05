import 'dotenv/config';
import { getGTMSnapshot } from './gtm-report.js';

const today = new Date();
const dayName = today.toLocaleDateString('en-SG', { weekday: 'long', timeZone: 'Asia/Singapore' });
const dateLabel = today.toLocaleDateString('en-SG', { month: 'short', day: 'numeric', timeZone: 'Asia/Singapore' });
const isWednesday = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Singapore' }) === 'Wednesday';

// ─── GTM Pipeline Briefing (every weekday) ────────────────────────────────────

let gtm = null;
try {
  gtm = await getGTMSnapshot();
} catch (e) {
  console.warn('⚠ GTM unavailable:', e?.message || String(e));
}

// ─── Xero AR (Wednesday only) ─────────────────────────────────────────────────

let ar = null;
if (isWednesday) {
  try {
    const { getARSnapshot } = await import('./ar-check.js');
    ar = await getARSnapshot();
  } catch (e) {
    console.warn('⚠ Xero unavailable:', e?.message || String(e));
  }
}

// ─── Build Slack blocks ───────────────────────────────────────────────────────

const blocks = [
  { type: 'header', text: { type: 'plain_text', text: `📋 Daily Ops Briefing — ${dayName}, ${dateLabel}` } },
];

// Pipeline section
if (gtm?.pipeline) {
  const p = gtm.pipeline;

  const staleLines = p.staleDeals.length > 0
    ? p.staleDeals.slice(0, 6).map(d => `• *${d.account}* (${d.stage}) — ${d.daysSince}d since last contact`).join('\n')
    : null;

  const overdueLines = p.overdueNextSteps.length > 0
    ? p.overdueNextSteps.slice(0, 6).map(d => `• *${d.account}* — ${d.nextStep || 'next step overdue'}`).join('\n')
    : null;

  const stuckLines = p.stuckDeals.length > 0
    ? p.stuckDeals.slice(0, 4).map(d => `• *${d.account}* (${d.stage})`).join('\n')
    : null;

  const pipelineSummary = [
    `*${p.totalDeals}* active deals`,
    p.wonThisWeek > 0 ? `🏆 *${p.wonThisWeek} won this week*` : null,
    `Health: 🔴 ${p.health.red}  🟡 ${p.health.yellow}  🟢 ${p.health.green}`,
  ].filter(Boolean).join(' · ');

  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `📈 *Pipeline*\n${pipelineSummary}` } });

  if (staleLines || overdueLines || stuckLines) {
    const actionText = [
      staleLines ? `*Needs contact today:*\n${staleLines}` : null,
      overdueLines ? `*Overdue next steps:*\n${overdueLines}` : null,
      stuckLines ? `*Stuck deals:*\n${stuckLines}` : null,
    ].filter(Boolean).join('\n\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: actionText } });
  } else {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '✅ No deals flagged — pipeline clean' } });
  }
} else {
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '📈 *Pipeline* — data unavailable' } });
}

// Inbound leads (today count)
if (gtm?.inbound) {
  const ib = gtm.inbound;
  if (ib.newThisWeek > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `📥 ${ib.newThisWeek} new inbound lead${ib.newThisWeek !== 1 ? 's' : ''} this week in Airtable` }],
    });
  }
}

// Wednesday: overdue invoice escalation (30+ days only)
if (isWednesday) {
  blocks.push({ type: 'divider' });

  if (ar) {
    const urgent = ar.overdue.filter(i => i.daysOverdue > 30).sort((a, b) => b.daysOverdue - a.daysOverdue);
    if (urgent.length > 0) {
      const lines = urgent.slice(0, 8).map(i =>
        `• *${i.contact}* — ${i.currency} ${i.amountDue} · *${i.daysOverdue}d overdue* (due ${i.dueDate})`
      ).join('\n');
      const extra = urgent.length > 8 ? `\n_…and ${urgent.length - 8} more_` : '';
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `🔴 *Mid-Week AR Escalation — ${urgent.length} invoices 30+ days overdue*\n${lines}${extra}` },
      });
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: 'Chase each by EOD → log in Trello → escalate to Fleire if no response after 2 follow-ups' }],
      });
    } else {
      const mildOverdue = ar.overdue.filter(i => i.daysOverdue > 0 && i.daysOverdue <= 30).length;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `📋 *AR check* — no 30+ day invoices${mildOverdue > 0 ? ` · ${mildOverdue} mild overdue (< 30d)` : ' · all current ✅'}` },
      });
    }
  } else {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '📋 *AR* — Xero unavailable, skipping mid-week escalation' }],
    });
  }
}

// ─── Send ─────────────────────────────────────────────────────────────────────

const webhookUrl = process.env.SLACK_WEBHOOK_URL;
if (!webhookUrl) {
  console.log('⚠ SLACK_WEBHOOK_URL not set — would have sent:');
  console.log(JSON.stringify(blocks, null, 2));
} else {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  console.log(`✓ Daily ops briefing sent (${dayName}${isWednesday ? ' + AR escalation' : ''})`);
}
