import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { sendEmail, resolveRecipients } from './email-utils.js';
import { fetchPipelineRows } from './gtm-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'automation-state.json');
const BRIEF_RESEND_DAYS = 7; // re-send brief if deal still in Discovery after 7 days
const testing = process.env.TESTING_MODE !== 'false';

const SKU_CONTEXT = {
  'Video Repurposing': {
    pitch: 'They want to maximise their existing video content. Lead with AI-enhanced repurposing — one long video becomes 10+ short clips, optimised per platform.',
    questions: [
      'How many videos do you currently produce per month?',
      'Which platforms are you targeting? (TikTok, Reels, Shorts, LinkedIn)',
      'Do you have raw footage, or only finished videos?',
      'Who currently handles editing? What's the turnaround time?',
    ],
    pricingRef: 'Video Repurposing package — typically $800–$1,500/mo depending on volume. Add-on to existing plan or standalone.',
  },
  'Social Media Growth Pack': {
    pitch: 'They want full social presence. Lead with the growth pack: content calendar, brand-consistent graphics + copy, scheduling, and monthly reporting.',
    questions: [
      'Which platforms do you need covered?',
      'Do you have brand guidelines? Logo files?',
      'How many posts per week are you targeting?',
      'Do you have an in-house designer, or do you need us end-to-end?',
    ],
    pricingRef: 'Social Media Growth Pack — starts at $1,200/mo for up to 12 posts/month across 2 platforms.',
  },
  'Unlimited Content': {
    pitch: 'They want volume. Lead with unlimited content — graphics + copy + video now included in the $1,500/mo tier. Highlight cost per piece vs. hiring in-house.',
    questions: [
      'What types of content do you need most? (graphics, copy, video, all three?)',
      'Do you have brand assets ready? (logo, colours, fonts)',
      'What's your current content bottleneck — speed, cost, or quality?',
      'Do you have a content calendar or do you need us to build one?',
    ],
    pricingRef: 'Unlimited Content (with video) — $1,500/mo. Unlimited Content (graphics + copy only) — $1,000/mo.',
  },
  'Unlimited Graphics': {
    pitch: 'They need design volume. Lead with unlimited graphics — fast turnaround, brand-consistent, no per-asset fee.',
    questions: [
      'What types of graphics? (social posts, ads, presentations, web assets?)',
      'Do you have brand guidelines?',
      'What's your typical turnaround requirement?',
      'How many assets per week are you estimating?',
    ],
    pricingRef: 'Unlimited Graphics — $500/mo. Can be bundled with Unlimited Copies for $1,000/mo.',
  },
  'Unlimited Copies': {
    pitch: 'They need copy volume. Lead with unlimited copies — captions, blogs, email, ads. AI-assisted but human-reviewed.',
    questions: [
      'What types of copy? (social captions, email newsletters, blogs, ad copy?)',
      'Do you have a brand voice guide?',
      'How many pieces per week are you estimating?',
      'Do you need SEO optimisation?',
    ],
    pricingRef: 'Unlimited Copies — $500/mo. Can be bundled with Unlimited Graphics for $1,000/mo.',
  },
  'KOL': {
    pitch: 'They want influencer campaigns. Lead with our KOL network and management — we handle sourcing, briefing, and reporting. Emphasise ROI tracking vs. doing it themselves.',
    questions: [
      'What tier of influencer? (nano 1K–10K, micro 10K–50K, mid-tier 50K–100K)',
      'How many creators per campaign?',
      'Campaign duration — one-off or ongoing?',
      'What's the primary objective? (awareness, conversions, UGC content?)',
      'Which platforms? (Instagram, TikTok, YouTube?)',
    ],
    pricingRef: 'KOL — varies by tier. Nano: ₱3,500/video + ₱6,500 management. Micro: ₱12,000/video + ₱10,000 management. DashoContent adds 45% service fee on creator cost.',
  },
  'Consultation': {
    pitch: 'They want strategic direction before committing. Lead with a brand audit or content strategy session. Frame it as the first step that defines everything else.',
    questions: [
      'What specific challenge are you trying to solve in the next 90 days?',
      'Have you worked with a content agency before? What worked / didn't work?',
      'What does success look like for you 6 months from now?',
      'Do you have an internal marketing team we'd be supporting?',
    ],
    pricingRef: 'Brand Audit Consultation — $200 one-time. Content Strategy Session — $350/session. Often waived or credited when client signs a package.',
  },
  'Unsure': {
    pitch: 'SKU is not yet confirmed. Use this call to qualify and narrow down — budget, content maturity, team size, and bottleneck.',
    questions: [
      'What's your biggest content challenge right now?',
      'What's your estimated monthly budget for content?',
      'Do you have an in-house team, or would we be their entire content function?',
      'Which platforms matter most to you right now?',
      'Have you worked with a content agency before?',
    ],
    pricingRef: 'Qualify first. Standard entry points: $500/mo (single service), $1,000/mo (Unlimited Content), $1,500/mo (with video), custom for KOL and enterprise.',
  },
};

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { callBriefs: {}, proposalDrafts: {} };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function shouldSendBrief(account, state) {
  const lastSent = state.callBriefs[account];
  if (!lastSent) return true;
  const daysSinceSent = Math.floor((Date.now() - new Date(lastSent)) / 86400000);
  return daysSinceSent >= BRIEF_RESEND_DAYS;
}

function buildBriefHtml(deal) {
  const sku = deal['Likely SKU'] || 'Unsure';
  const ctx = SKU_CONTEXT[sku] || SKU_CONTEXT['Unsure'];
  const daysSinceContact = daysSince(deal['Last Contact Date']);
  const today = new Date().toLocaleDateString('en-SG', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Singapore' });

  const contactBlock = [
    deal['Primary Contact'] ? `<strong>${deal['Primary Contact']}</strong>` : null,
    deal['Primary Contact Role'] ? `<span style="color:#888">${deal['Primary Contact Role']}</span>` : null,
    deal['Primary Contact Email'] ? `<a href="mailto:${deal['Primary Contact Email']}">${deal['Primary Contact Email']}</a>` : null,
  ].filter(Boolean).join(' · ');

  const questions = ctx.questions.map(q => `<li>${q}</li>`).join('');
  const notes = deal['Notes'] ? `<p style="background:#f9f9f9;border-left:3px solid #e5e7eb;padding:8px 12px;border-radius:4px;font-size:12px;color:#555;white-space:pre-wrap">${deal['Notes']}</p>` : '<p style="color:#aaa;font-size:12px">No notes in GTM sheet.</p>';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #111; max-width: 600px; margin: 0 auto; padding: 24px; }
  h2 { font-size: 18px; font-weight: 900; margin-bottom: 4px; }
  .badge { display: inline-block; background: #f5a623; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px; letter-spacing: 1px; text-transform: uppercase; margin-left: 8px; vertical-align: middle; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #aaa; border-bottom: 1px solid #f0f0f0; padding-bottom: 4px; margin-bottom: 10px; }
  .pitch-box { background: #fffbf0; border: 1.5px solid #f5a623; border-radius: 6px; padding: 12px 16px; font-size: 13px; line-height: 1.7; }
  ul { padding-left: 18px; margin: 0; }
  li { margin-bottom: 6px; line-height: 1.6; }
  .meta { color: #888; font-size: 11px; }
  .footer { border-top: 1px solid #eee; padding-top: 10px; font-size: 10px; color: #aaa; margin-top: 24px; }
</style></head><body>

<h2>${deal['Account']}<span class="badge">Discovery Call</span></h2>
<p class="meta">${today}${daysSinceContact !== null ? ` · Last contact: ${daysSinceContact}d ago (${deal['Last Contact Date']})` : ''}</p>

<div class="section">
  <div class="section-title">Contact</div>
  <p>${contactBlock || '<span style="color:#aaa">No contact details in GTM sheet</span>'}</p>
  ${deal['Company URL'] ? `<p><a href="${deal['Company URL']}">${deal['Company URL']}</a></p>` : ''}
</div>

<div class="section">
  <div class="section-title">Likely SKU: ${sku}</div>
  <div class="pitch-box">${ctx.pitch}</div>
</div>

<div class="section">
  <div class="section-title">Questions to Ask on the Call</div>
  <ul>${questions}</ul>
</div>

<div class="section">
  <div class="section-title">Pricing Reference (Don't Share Screen — Internal Only)</div>
  <p style="font-size:12px;color:#555">${ctx.pricingRef}</p>
  <p style="font-size:11px;color:#aaa">Always present as value vs. in-house cost. Don't lead with numbers — anchor the problem first.</p>
</div>

<div class="section">
  <div class="section-title">GTM Notes</div>
  ${notes}
  ${deal['Next Step'] ? `<p style="font-size:12px;color:#555"><strong>Next step logged:</strong> ${deal['Next Step']}</p>` : ''}
</div>

<div class="section">
  <div class="section-title">After the Call</div>
  <ul>
    <li>Update <strong>Last Contact Date</strong> and <strong>Stage</strong> in the GTM sheet immediately</li>
    <li>Log the <strong>outcome and next step</strong> in Notes</li>
    <li>If interested → move to <strong>Proposal Out</strong> and request a proposal draft from Ops</li>
    <li>If not a fit → mark <strong>Lost</strong> with a reason</li>
  </ul>
</div>

<div class="footer">Auto-generated by dasho-ops · ${deal['Account']} · ${today}</div>
</body></html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let rows;
try {
  rows = await fetchPipelineRows();
} catch (e) {
  console.error('Failed to fetch GTM sheet:', e?.message || String(e));
  process.exit(1);
}

const discoveryDeals = rows.filter(r => r['Stage'] === 'Discovery Booked');
console.log(`Found ${discoveryDeals.length} deal(s) in Discovery Booked stage`);

const state = loadState();
const { to, cc } = resolveRecipients(testing);
let sent = 0;

for (const deal of discoveryDeals) {
  const account = deal['Account'];
  if (!account) continue;

  if (!shouldSendBrief(account, state)) {
    const lastSent = state.callBriefs[account];
    console.log(`  ↳ ${account} — brief sent ${lastSent}, skipping`);
    continue;
  }

  const html = buildBriefHtml(deal);
  const subject = `${testing ? '[TEST] ' : ''}Discovery Call Brief — ${account}`;

  try {
    await sendEmail({ subject, html, to, cc });
    state.callBriefs[account] = new Date().toISOString().slice(0, 10);
    console.log(`✓ Brief sent: ${account} → ${to}`);
    sent++;
  } catch (e) {
    console.error(`✗ Failed to send brief for ${account}:`, e?.message || String(e));
  }
}

if (sent === 0) {
  console.log('✓ No new briefs to send today');
} else {
  saveState(state);
  console.log(`✓ State updated — ${sent} brief(s) sent`);
}
