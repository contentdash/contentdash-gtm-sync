import 'dotenv/config';

const AIRTABLE_BASE = 'appdOhglYCp56PrrY';
const AIRTABLE_TABLE = 'tblbQbb5l9ygvbEFS';

function parseCSV(text) {
  // Full RFC-4180 parser: handles embedded newlines and commas inside quoted fields
  const records = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; } // escaped quote
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field.trim()); field = ''; }
      else if (ch === '\r' && next === '\n') { row.push(field.trim()); records.push(row); row = []; field = ''; i++; }
      else if (ch === '\n') { row.push(field.trim()); records.push(row); row = []; field = ''; }
      else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field.trim()); records.push(row); }

  if (records.length < 2) return [];
  const headers = records[0].map(h => h.replace(/^"|"$/g, '').trim());
  return records.slice(1).filter(r => r.some(f => f)).map(r => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = r[i] || ''; });
    return obj;
  });
}

// Public Google Sheet (shared as "Anyone with the link can view")
const PIPELINE_SHEET_ID = '1qEYuSoqzQuqmTPDFB-KgNcXb3bYIYqmWMAX2mOLC5pY';
const PIPELINE_SHEET_TAB = 'Pipeline Ops';

export async function fetchPipelineRows() {
  const sheetId = process.env.SHEET_ID || PIPELINE_SHEET_ID;
  const tab = encodeURIComponent(process.env.SHEET_TAB || PIPELINE_SHEET_TAB);
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${tab}`;
  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`Sheet CSV HTTP ${res.status}`);
  const text = await res.text();
  return parseCSV(text);
}

async function fetchAirtableLeads() {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) throw new Error('AIRTABLE_PAT not set');

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?pageSize=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
  if (!res.ok) throw new Error(`Airtable HTTP ${res.status}`);
  const data = await res.json();
  return data.records || [];
}

// Stage order for funnel display — matches actual sheet stage names
const FUNNEL_STAGES = [
  'ICP Fit', 'Outreach Sent', 'Replied', 'Qualification Booked', 'Qualified',
  'Discovery Booked', 'Discovery Done', 'Proposal Out', 'Proposal Sent', 'Negotiation',
  'Multi-Threaded', 'Kickoff / Won', 'Won',
];
// All closed stages in the sheet (won or lost variants)
const CLOSED_STAGES = new Set(['Won', 'Lost', 'Kickoff / Won', 'Closed Lost', 'Closed Won']);
// Proposal-or-beyond stages for conversion rate
const PROPOSAL_STAGES = new Set(['Proposal Out', 'Proposal Sent', 'Negotiation', 'Multi-Threaded', 'Kickoff / Won', 'Won', 'Closed Won']);
// Only count deals contacted within this many days as "active" (filters zombie leads)
const ACTIVE_CONTACT_THRESHOLD_DAYS = 90;

export async function getGTMSnapshot() {
  const today = new Date();
  const sevenDaysAgo = new Date(today - 7 * 86400000);
  const thirtyDaysAgo = new Date(today - 30 * 86400000);

  const [rows, airtableRecords] = await Promise.all([
    fetchPipelineRows().catch(e => { console.warn('⚠ Pipeline sheet unavailable:', e.message); return null; }),
    fetchAirtableLeads().catch(e => { console.warn('⚠ Airtable unavailable:', e.message); return null; }),
  ]);

  let pipeline = null;
  if (rows) {
    const all = rows.filter(r => r['Account']);
    // Active = not closed AND contacted within threshold (filters zombie leads from prior years)
    const active = all.filter(r => {
      if (CLOSED_STAGES.has(r['Stage'])) return false;
      const daysSince = parseInt(r['Days Since Last Contact']) || 9999;
      return daysSince <= ACTIVE_CONTACT_THRESHOLD_DAYS;
    });

    const stageCounts = {};
    const stageValues = {};
    const staleDeals = [];
    const overdueNextSteps = [];
    const stuckDeals = [];
    let healthRed = 0, healthYellow = 0, healthGreen = 0;
    let newThisWeek = 0;

    active.forEach(row => {
      const stage = row['Stage'] || 'Unknown';
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;

      const val = parseFloat(String(row['Value']).replace(/[^0-9.]/g, '')) || 0;
      stageValues[stage] = (stageValues[stage] || 0) + val;

      const daysSince = parseInt(row['Days Since Last Contact']) || 0;
      if (daysSince > 7) staleDeals.push({ account: row['Account'], stage, daysSince, owner: row['Owner'] });

      if (String(row['Overdue Next Step']).toUpperCase() === 'Y') {
        overdueNextSteps.push({
          account: row['Account'], stage,
          nextStep: row['Next Step'], nextStepDate: row['Next Step Date'],
        });
      }

      if (String(row['Stuck Deal']).toUpperCase() === 'Y') {
        stuckDeals.push({ account: row['Account'], stage, daysSince });
      }

      const health = String(row['Health']).toLowerCase();
      if (health.includes('red') || health === '🔴') healthRed++;
      else if (health.includes('yellow') || health.includes('amber') || health === '🟡') healthYellow++;
      else if (health.includes('green') || health === '🟢') healthGreen++;

      if (row['Created Date'] && new Date(row['Created Date']) >= sevenDaysAgo) newThisWeek++;
    });

    // Funnel: active stages + won/closed in last 30d
    const wonRecent = all.filter(r =>
      (r['Stage'] === 'Kickoff / Won' || r['Stage'] === 'Won' || r['Stage'] === 'Closed Won') &&
      r['Created Date'] && new Date(r['Created Date']) >= thirtyDaysAgo
    );
    const funnel = FUNNEL_STAGES.map(stage => ({
      stage, count: stageCounts[stage] || 0, value: stageValues[stage] || 0,
    })).filter(f => f.count > 0);

    // Conversion rate: active deals that reached Proposal or beyond
    const proposalReached = active.filter(r => PROPOSAL_STAGES.has(r['Stage'])).length + wonRecent.length;
    const totalEntered = active.length + wonRecent.length;
    const proposalConvRate = totalEntered > 0
      ? +((proposalReached / totalEntered) * 100).toFixed(1)
      : 0;

    const wonThisWeek = all.filter(r =>
      (r['Stage'] === 'Kickoff / Won' || r['Stage'] === 'Won' || r['Stage'] === 'Closed Won') &&
      r['Created Date'] && new Date(r['Created Date']) >= sevenDaysAgo
    );

    pipeline = {
      totalDeals: active.length,
      totalPipelineValue: +Object.values(stageValues).reduce((s, v) => s + v, 0).toFixed(2),
      stageCounts,
      stageValues,
      funnel,
      proposalConvRate,
      staleDeals: staleDeals.sort((a, b) => b.daysSince - a.daysSince).slice(0, 8),
      overdueNextSteps: overdueNextSteps.slice(0, 8),
      stuckDeals: stuckDeals.slice(0, 8),
      health: { red: healthRed, yellow: healthYellow, green: healthGreen },
      newThisWeek,
      wonThisWeek: wonThisWeek.length,
      wonThisWeekDetails: wonThisWeek.map(r => ({ account: r['Account'], value: r['Value'] })),
    };
  }

  let inbound = null;
  if (airtableRecords) {
    const recentLeads = airtableRecords.filter(r => {
      const t = r.createdTime || r.fields?.['Created'] || '';
      return t && new Date(t) >= sevenDaysAgo;
    });
    inbound = {
      total: airtableRecords.length,
      newThisWeek: recentLeads.length,
      recent: recentLeads.slice(0, 5).map(r => ({
        account: r.fields?.['Account'] || r.fields?.['Company'] || r.fields?.['Name'] || 'Unknown',
        email: r.fields?.['Email'] || r.fields?.['Primary Contact Email'] || '',
        createdAt: (r.createdTime || '').slice(0, 10),
      })),
    };
  }

  return { pipeline, inbound, asOf: today.toISOString().slice(0, 10) };
}

if (process.argv[1]?.endsWith('gtm-report.js')) {
  const snap = await getGTMSnapshot();
  console.log('\n=== GTM SNAPSHOT ===');
  console.log(`As of: ${snap.asOf}`);
  if (snap.pipeline) {
    const p = snap.pipeline;
    console.log(`Active deals: ${p.totalDeals} | Pipeline value: $${p.totalPipelineValue}`);
    console.log(`Proposal conversion rate: ${p.proposalConvRate}%`);
    console.log('Funnel:', p.funnel.map(f => `${f.stage}(${f.count})`).join(' → '));
    console.log(`Stale (>5d): ${p.staleDeals.length} | Overdue next steps: ${p.overdueNextSteps.length} | Stuck: ${p.stuckDeals.length}`);
    console.log(`Health — 🔴 ${p.health.red} | 🟡 ${p.health.yellow} | 🟢 ${p.health.green}`);
    console.log(`New this week: ${p.newThisWeek} | Won this week: ${p.wonThisWeek}`);
  } else {
    console.log('Pipeline: unavailable (set APPS_SCRIPT_URL + APPS_SCRIPT_TOKEN)');
  }
  if (snap.inbound) {
    console.log(`\nInbound (Airtable): ${snap.inbound.total} total | ${snap.inbound.newThisWeek} new this week`);
    snap.inbound.recent.forEach(l => console.log(`  ${l.createdAt} — ${l.account} ${l.email}`));
  } else {
    console.log('Inbound: unavailable (set AIRTABLE_PAT)');
  }
}
