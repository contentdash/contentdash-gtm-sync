import 'dotenv/config';

const AIRTABLE_BASE = 'appdOhglYCp56PrrY';
const AIRTABLE_TABLE = 'tblbQbb5l9ygvbEFS';
const LOOKBACK_MINUTES = 35; // 5-min buffer over 30-min cron

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
    await postToSlack(leads);
  } else {
    console.log('✓ No new leads — Slack silent');
  }
} catch (e) {
  console.error('Lead alert error:', e?.message || String(e));
  process.exit(1);
}
