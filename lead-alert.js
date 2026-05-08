import 'dotenv/config';

const AIRTABLE_BASE = 'appdOhglYCp56PrrY';
const AIRTABLE_TABLE = 'tblbQbb5l9ygvbEFS';
const LOOKBACK_MINUTES = 35; // 5-min buffer over 30-min cron

const SKU_MAP = [
  ['Unlimited Copies',        ['copy', 'copies', 'unlimited copies', 'text']],
  ['Unlimited Graphics',      ['graphics', 'design', 'creative', 'unlimited graphics']],
  ['Unlimited Content',       ['content', 'unlimited content']],
  ['Social Media Growth Pack',['social', 'growth pack', 'social media']],
  ['Video Repurposing',       ['video', 'repurposing', 'reels', 'shorts']],
  ['KOL',                     ['kol', 'influencer', 'creator']],
  ['Consultation',            ['consultation', 'consult', 'strategy']],
];

function inferSku(budget, industry, problem) {
  const raw = `${budget} ${industry} ${problem}`.toLowerCase();
  for (const [sku, keywords] of SKU_MAP) {
    if (keywords.some(k => raw.includes(k))) return sku;
  }
  return 'Unsure';
}

async function getNewLeads() {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) throw new Error('AIRTABLE_PAT not set');

  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const formula = encodeURIComponent(`IS_AFTER(CREATED_TIME(), '${since}')`);
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${formula}`,
    { headers: { Authorization: `Bearer ${pat}` } },
  );
  if (!res.ok) throw new Error(`Airtable HTTP ${res.status}`);
  const data = await res.json();

  return (data.records || []).map(r => ({
    id: r.id,
    name: r.fields['Name'] || 'Unknown',
    company: r.fields['Your company name'] || '',
    email: r.fields['Your Email'] || '',
    designation: r.fields['Your designation'] || '',
    industry: r.fields['Which industry is your brand in?'] || '',
    budget: r.fields['What is your estimated monthly budget for social media content creation?'] || '',
    problem: r.fields['What was the MAIN PROBLEM that you want to solve with DashoContent?'] || '',
    createdAt: r.createdTime,
  }));
}

// Push new lead into GTM Pipeline Ops sheet via Apps Script doPost
async function syncLeadToGTM(lead) {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.PIPELINE_WEBHOOK_TOKEN;
  if (!url || !token) return; // optional — skip silently if not configured

  const notes = [
    lead.designation ? `Role: ${lead.designation}` : null,
    lead.industry ? `Industry: ${lead.industry}` : null,
    lead.budget ? `Budget: ${lead.budget}` : null,
    lead.problem ? `Problem: ${lead.problem}` : null,
    `Email: ${lead.email}`,
  ].filter(Boolean).join('\n');

  const payload = {
    sourceSystem: 'Airtable',
    sourceRecordId: lead.id,
    sourceRecordUrl: `https://airtable.com/${AIRTABLE_BASE}/${lead.id}`,
    createdTime: lead.createdAt,
    account: lead.company || lead.name,
    primaryContact: lead.name,
    primaryContactRole: lead.designation,
    companyUrl: '',
    leadSource: 'Airtable site form',
    notes,
    likelySku: inferSku(lead.budget, lead.industry, lead.problem),
    value: '',
  };

  try {
    const res = await fetch(`${url}?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.ok) {
      console.log(`  ✓ GTM row ${json.action}: ${payload.account} (row ${json.rowNumber})`);
    } else {
      console.warn(`  ⚠ GTM sync failed for ${payload.account}: ${json.error}`);
    }
  } catch (e) {
    console.warn(`  ⚠ GTM sync error for ${payload.account}: ${e?.message || String(e)}`);
  }
}

async function postToSlack(leads) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) { console.log('⚠ SLACK_WEBHOOK_URL not set'); return; }

  const lines = leads.map(l => {
    const meta = [
      l.designation || null,
      l.industry || null,
      l.budget ? `Budget: ${l.budget}` : null,
    ].filter(Boolean).join(' · ');
    return [
      `• *${l.name}*${l.company ? ` — ${l.company}` : ''}`,
      meta ? `  _${meta}_` : null,
      l.email ? `  ${l.email}` : null,
      l.problem ? `  "${l.problem.slice(0, 120)}${l.problem.length > 120 ? '…' : ''}"` : null,
    ].filter(Boolean).join('\n');
  });

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `📥 ${leads.length} New Inbound Lead${leads.length !== 1 ? 's' : ''}` } },
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n\n') } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'Qualify → add to pipeline → book discovery call' }] },
      ],
    }),
  });
  console.log(`✓ Slack alert: ${leads.length} new lead${leads.length !== 1 ? 's' : ''}`);
}

try {
  const leads = await getNewLeads();
  console.log(`Checked last ${LOOKBACK_MINUTES}min — ${leads.length} new lead(s)`);
  if (leads.length > 0) {
    leads.forEach(l => console.log(`  ${l.name} <${l.email}> — ${l.company}`));
    // Run Slack alert and GTM sync in parallel; GTM failure doesn't block Slack
    await Promise.all([
      postToSlack(leads),
      ...leads.map(l => syncLeadToGTM(l)),
    ]);
  } else {
    console.log('✓ No new leads — Slack silent');
  }
} catch (e) {
  console.error('Lead alert error:', e?.message || String(e));
  process.exit(1);
}
