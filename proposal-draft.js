import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { sendEmail, resolveRecipients } from './email-utils.js';
import { fetchPipelineRows } from './gtm-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'automation-state.json');
const DRAFT_RESEND_DAYS = 14;
const testing = process.env.TESTING_MODE !== 'false';

// Stages where a proposal draft is relevant
const PROPOSAL_TRIGGER_STAGES = new Set([
  'Discovery Booked', 'Discovery Done', 'Routed + Pitched',
]);

// ─── Pricing reference (ported from calculator_pricing.js + known rates) ───────
// All prices in USD unless noted. PHP rate: ~56.75
const PACKAGES = {
  'Unlimited Copies': {
    monthly: 500,
    currency: 'USD',
    inclusions: ['Unlimited social captions', 'Unlimited ad copy', 'Unlimited email copy', 'Unlimited blog posts (up to 800 words)', 'AI-assisted, human-reviewed'],
    notes: 'Can be bundled with Unlimited Graphics for $1,000/mo.',
    setup: 0,
  },
  'Unlimited Graphics': {
    monthly: 500,
    currency: 'USD',
    inclusions: ['Unlimited social graphics', 'Unlimited story/reel cover frames', 'Unlimited ad creatives', 'Unlimited presentation slides', 'Brand-consistent, unlimited revisions'],
    notes: 'Can be bundled with Unlimited Copies for $1,000/mo.',
    setup: 0,
  },
  'Unlimited Content': {
    monthly: 1500,
    currency: 'USD',
    inclusions: ['Unlimited graphics', 'Unlimited copy (captions, ads, email)', 'Unlimited short-form video (reels/shorts)', 'Brand strategy alignment', 'Content calendar planning', 'Unlimited revisions'],
    notes: 'Was $1,000/mo (graphics + copy only). Now $1,500/mo includes video. Existing clients can upgrade.',
    setup: 0,
  },
  'Social Media Growth Pack': {
    monthly: 1200,
    currency: 'USD',
    inclusions: ['Up to 12 posts/month across 2 platforms', 'Monthly content calendar', 'Captions + hashtag strategy', 'Graphics + basic video', 'Monthly performance report'],
    notes: 'Custom quote for 3+ platforms or higher post volumes.',
    setup: 200,
  },
  'Video Repurposing': {
    monthly: 1000,
    currency: 'USD',
    inclusions: ['Up to 20 short-form clips/month from long-form footage', 'Platform-optimised for TikTok, Reels, Shorts', 'Captions, subtitles, and B-roll integration', 'Thumbnail creation', 'Turnaround: 3–5 business days per clip'],
    notes: 'Volume discounts available. Can be standalone or add-on.',
    setup: 0,
  },
  'KOL': {
    monthly: null,
    currency: 'PHP',
    inclusions: ['KOL sourcing and vetting', 'Brief preparation and creator coordination', 'Content review and approval workflow', 'Cross-platform posting management', 'Campaign analytics and reporting'],
    notes: 'Pricing varies by tier: Nano (₱3,500/video), Micro (₱12,000/video), Mid-tier (₱28,000/video). DashoContent adds 45% service fee on creator cost plus management fee.',
    setup: null,
  },
  'Consultation': {
    monthly: null,
    currency: 'USD',
    inclusions: ['1.5-hour brand audit or strategy session', 'Written recommendations report', 'Content roadmap for 90 days', 'Q&A and follow-up notes'],
    notes: 'Brand Audit: $200. Content Strategy: $350. Often credited when client signs a package.',
    setup: null,
  },
  'Unsure': {
    monthly: null,
    currency: 'USD',
    inclusions: [],
    notes: 'SKU not yet confirmed — complete the discovery call first, then request a targeted draft.',
    setup: null,
  },
};

// KOL pricing calculator (from calculator_pricing.js)
const KOL_RATES = { nano: 3500, micro: 12000, 'mid-tier': 28000, macro: 65000 };
const KOL_MGMT  = { nano: 6500, micro: 10000, 'mid-tier': 20000, macro: 45000 };

function formatUsd(n) { return n != null ? `$${Math.round(n).toLocaleString()}` : '—'; }
function formatPhp(n) { return n != null ? `₱${Math.round(n).toLocaleString()}` : '—'; }

function buildPricingBlock(sku, deal) {
  const pkg = PACKAGES[sku] || PACKAGES['Unsure'];

  if (sku === 'KOL') {
    const tiers = ['nano', 'micro', 'mid-tier'].map(tier => `
      <tr>
        <td style="color:#555">${tier.charAt(0).toUpperCase() + tier.slice(1)} (${tier === 'nano' ? '1K–10K' : tier === 'micro' ? '10K–50K' : '50K–100K'})</td>
        <td>${formatPhp(KOL_RATES[tier])}/video</td>
        <td style="color:#888">${formatPhp(KOL_MGMT[tier])}/creator/mo mgmt</td>
      </tr>`).join('');
    return `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr style="background:#f9f9f9;font-weight:700"><th style="text-align:left;padding:5px 8px">KOL Tier</th><th style="padding:5px 8px">Rate/Video</th><th style="padding:5px 8px">Management</th></tr>
        ${tiers}
      </table>
      <p style="font-size:11px;color:#888;margin-top:6px">DashoContent service fee: +45% on creator cost. Volume discounts apply for 4+ creators (15%) or 8+ creators (30%).</p>`;
  }

  const inclList = pkg.inclusions.map(i => `<li>${i}</li>`).join('');
  const priceStr = pkg.monthly ? `${pkg.currency === 'USD' ? formatUsd(pkg.monthly) : formatPhp(pkg.monthly)}/mo` : 'Custom — quote after discovery';
  const setupStr = pkg.setup > 0 ? ` + ${formatUsd(pkg.setup)} one-time setup` : '';

  return `
    <div style="background:#fffbf0;border:1.5px solid #f5a623;border-radius:6px;padding:12px 16px">
      <div style="font-size:18px;font-weight:900;color:#111">${priceStr}${setupStr}</div>
      ${pkg.monthly ? `<div style="font-size:11px;color:#888;margin-top:2px">${pkg.currency === 'USD' ? '~₱' + Math.round(pkg.monthly * 56.75).toLocaleString() : ''}/mo at current rate</div>` : ''}
    </div>
    ${inclList ? `<ul style="margin-top:10px;padding-left:18px;font-size:12px;line-height:1.8">${inclList}</ul>` : ''}
    ${pkg.notes ? `<p style="font-size:11px;color:#888;margin-top:6px;font-style:italic">${pkg.notes}</p>` : ''}`;
}

function buildProposalHtml(deal) {
  const sku = deal['Likely SKU'] || 'Unsure';
  const today = new Date().toLocaleDateString('en-SG', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Singapore' });
  const validUntil = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-SG', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Singapore' });
  const contactName = deal['Primary Contact'] || '[Contact Name]';
  const company = deal['Account'] || '[Company]';
  const companyUrl = deal['Company URL'] ? `<a href="${deal['Company URL']}">${deal['Company URL']}</a>` : '';

  const pricingBlock = buildPricingBlock(sku, deal);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #111; max-width: 680px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; font-weight: 900; margin-bottom: 4px; }
  h2 { font-size: 15px; font-weight: 800; margin: 24px 0 8px; }
  .badge { display:inline-block;background:#111;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:10px;letter-spacing:1px;text-transform:uppercase;margin-left:8px;vertical-align:middle; }
  .review { background:#fff5f5;border:1.5px dashed #dc2626;border-radius:5px;padding:8px 14px;color:#dc2626;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:8px 0; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #aaa; border-bottom: 1px solid #f0f0f0; padding-bottom: 4px; margin-bottom: 10px; }
  .fill-box { background:#f9f9f9;border:1.5px dashed #d5d5d5;border-radius:5px;padding:10px 14px;font-size:12px;color:#bbb;line-height:1.8;margin:6px 0; }
  table { width:100%;border-collapse:collapse;font-size:12px; }
  td,th { padding:5px 8px;border-bottom:1px solid #f4f4f4;vertical-align:top;text-align:left; }
  .footer { border-top:1px solid #eee;padding-top:10px;font-size:10px;color:#aaa;margin-top:24px; }
</style></head><body>

<h1>Proposal Draft — ${company}<span class="badge">${sku}</span></h1>
<p style="color:#888;font-size:12px">Auto-drafted by dasho-ops · ${today} · <span style="color:#dc2626;font-weight:700">INTERNAL ONLY — review before sending to client</span></p>

<div class="review">⚠ Review all [FILL IN] sections before sending. Check pricing, customise the intro, and format in Canva.</div>

<div class="section">
  <div class="section-title">Client Details (verify before sending)</div>
  <table><tbody>
    <tr><td style="color:#888;width:30%">Company</td><td><strong>${company}</strong>${companyUrl ? ` · ${companyUrl}` : ''}</td></tr>
    <tr><td style="color:#888">Contact</td><td>${contactName}${deal['Primary Contact Role'] ? ` — ${deal['Primary Contact Role']}` : ''}</td></tr>
    <tr><td style="color:#888">Email</td><td>${deal['Primary Contact Email'] || '<span style="color:#dc2626">[FILL IN — not in GTM sheet]</span>'}</td></tr>
    <tr><td style="color:#888">Prepared by</td><td>Charlene Virlouvet · DashoContent</td></tr>
    <tr><td style="color:#888">Date</td><td>${today}</td></tr>
    <tr><td style="color:#888">Valid until</td><td>${validUntil}</td></tr>
  </tbody></table>
</div>

<div class="section">
  <div class="section-title">Opening (Personalise This)</div>
  <div class="fill-box">
    Hi ${contactName},<br><br>
    Thank you for taking the time to connect with us. Based on our conversation, I've put together a proposal for ${company} that addresses [FILL IN: the specific challenge they mentioned — e.g., "your need to scale content production ahead of your July product launch"].<br><br>
    [FILL IN: 1–2 sentences about what you heard on the call that shows you were listening. E.g., "I understand you're currently managing content with a small in-house team and need to increase output without increasing headcount."]
  </div>
</div>

<div class="section">
  <div class="section-title">Recommended Package — ${sku}</div>
  ${pricingBlock}
</div>

<div class="section">
  <div class="section-title">Why DashoContent for ${company}</div>
  <div class="fill-box">
    [FILL IN: 3 bullet points specific to their situation. Examples:]<br>
    • [Mirror their stated problem back — "You mentioned X. Here's how we solve it."]<br>
    • [Speed/quality advantage — e.g., "Turnaround in 3–5 days vs. hiring which takes 4–6 weeks"]<br>
    • [Cost comparison — e.g., "At $1,500/mo, you're getting a full content team for the cost of one junior hire"]
  </div>
</div>

${sku === 'KOL' ? `
<div class="section">
  <div class="section-title">Proposed Campaign Structure</div>
  <div class="fill-box">
    [FILL IN based on KOL requirements discussed:]<br>
    • Tier: [nano / micro / mid-tier]<br>
    • Number of creators: [X]<br>
    • Videos per creator per month: [X]<br>
    • Duration: [X months]<br>
    • Platforms: [Instagram / TikTok / YouTube]<br>
    • Estimated total: [calculate using KOL rates above]
  </div>
</div>` : ''}

<div class="section">
  <div class="section-title">Onboarding Process</div>
  <table><tbody>
    <tr><td style="color:#888;width:20%">Week 1</td><td>Brand intake form, asset collection, kickoff call, content strategy alignment</td></tr>
    <tr><td style="color:#888">Week 2</td><td>First batch of content delivered for review</td></tr>
    <tr><td style="color:#888">Week 3+</td><td>Regular delivery cadence, revision rounds, monthly performance check-in</td></tr>
  </tbody></table>
</div>

<div class="section">
  <div class="section-title">Terms</div>
  <ul style="font-size:12px;line-height:1.8;padding-left:18px">
    <li>Monthly rolling contract — cancel anytime with 30 days notice</li>
    ${sku === 'KOL' ? '<li>KOL campaigns: 50% upfront deposit, 50% on delivery</li>' : '<li>Payment due on the 1st of each month</li>'}
    <li>All content rights transferred to ${company} upon full payment</li>
    <li>Revisions: unlimited within the agreed scope</li>
  </ul>
</div>

<div class="section">
  <div class="section-title">Next Steps</div>
  <ol style="font-size:12px;line-height:1.8;padding-left:18px">
    <li>Review this proposal and let us know if you have questions</li>
    <li>We'll send a contract upon your go-ahead</li>
    <li>Onboarding starts within 2 business days of signing</li>
  </ol>
  <p style="font-size:12px">Ready to move forward? Reply to this email or reach me at <strong>info@contentdash.app</strong>.</p>
</div>

<hr style="border:none;border-top:2px solid #f5a623;margin:24px 0">
<p style="font-size:11px;color:#888;text-align:center">DashoContent by ContentDash PTE LTD · <a href="https://dashocontent.com">dashocontent.com</a></p>

<div class="footer">
  <strong>Internal notes (remove before sending):</strong><br>
  GTM Stage at draft time: ${deal['Stage']} · Likely SKU: ${sku} · Last contact: ${deal['Last Contact Date'] || 'not logged'}<br>
  Notes from GTM: ${deal['Notes'] ? deal['Notes'].slice(0, 200) + (deal['Notes'].length > 200 ? '…' : '') : 'none'}<br>
  Auto-drafted by dasho-ops · ${today}
</div>
</body></html>`;
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

function shouldSendDraft(account, state) {
  const lastSent = state.proposalDrafts[account];
  if (!lastSent) return true;
  const daysSinceSent = Math.floor((Date.now() - new Date(lastSent)) / 86400000);
  return daysSinceSent >= DRAFT_RESEND_DAYS;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let rows;
try {
  rows = await fetchPipelineRows();
} catch (e) {
  console.error('Failed to fetch GTM sheet:', e?.message || String(e));
  process.exit(1);
}

// Only generate drafts for active deals in proposal-ready stages
const today = new Date();
const ninetyDaysAgo = new Date(today - 90 * 86400000);

const proposalDeals = rows.filter(r => {
  if (!r['Account']) return false;
  if (!PROPOSAL_TRIGGER_STAGES.has(r['Stage'])) return false;
  // Exclude deals with no recent contact (zombie leads)
  const lastContact = r['Last Contact Date'] ? new Date(r['Last Contact Date']) : null;
  if (lastContact && lastContact < ninetyDaysAgo) return false;
  // Must have shown interest
  const replyStatus = (r['Reply Status'] || '').toLowerCase();
  if (replyStatus && ['not interested', 'lost', 'no reply', 'ghosted'].some(s => replyStatus.includes(s))) return false;
  return true;
});

console.log(`Found ${proposalDeals.length} deal(s) eligible for proposal drafts`);

const state = loadState();
const { to, cc } = resolveRecipients(testing);
let sent = 0;

for (const deal of proposalDeals) {
  const account = deal['Account'];
  if (!account) continue;

  if (!shouldSendDraft(account, state)) {
    console.log(`  ↳ ${account} — draft sent ${state.proposalDrafts[account]}, skipping`);
    continue;
  }

  const html = buildProposalHtml(deal);
  const subject = `${testing ? '[TEST] ' : ''}Proposal Draft Ready — ${account} (${deal['Likely SKU'] || 'Unsure'})`;

  try {
    await sendEmail({ subject, html, to, cc });
    state.proposalDrafts[account] = new Date().toISOString().slice(0, 10);
    console.log(`✓ Proposal draft sent: ${account} → ${to}`);
    sent++;
  } catch (e) {
    console.error(`✗ Failed to send draft for ${account}:`, e?.message || String(e));
  }
}

if (sent === 0) {
  console.log('✓ No new proposal drafts to send today');
} else {
  saveState(state);
  console.log(`✓ State updated — ${sent} draft(s) sent`);
}
