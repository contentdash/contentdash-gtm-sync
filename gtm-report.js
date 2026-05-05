import 'dotenv/config';

const AIRTABLE_BASE = 'appdOhglYCp56PrrY';
const AIRTABLE_TABLE = 'tblbQbb5l9ygvbEFS';

async function fetchPipelineRows() {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.APPS_SCRIPT_TOKEN;
  if (!url || !token) throw new Error('APPS_SCRIPT_URL or APPS_SCRIPT_TOKEN not set');

  const res = await fetch(`${url}?token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Apps Script error');
  return data.rows || [];
}

async function fetchAirtableLeads() {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) throw new Error('AIRTABLE_PAT not set');

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?pageSize=100&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
  if (!res.ok) throw new Error(`Airtable HTTP ${res.status}`);
  const data = await res.json();
  return data.records || [];
}

// Stage order for funnel display (top of funnel → bottom)
const FUNNEL_STAGES = [
  'ICP Fit', 'Outreach Sent', 'Replied', 'Qualification Booked', 'Qualified',
  'Discovery Booked', 'Discovery Done', 'Proposal Sent', 'Negotiation', 'Won',
];
const CLOSED_STAGES = new Set(['Won', 'Lost']);

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
    const active = rows.filter(r => r['Account'] && !CLOSED_STAGES.has(r['Stage']));
    const all = rows.filter(r => r['Account']);

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
      if (daysSince > 5) staleDeals.push({ account: row['Account'], stage, daysSince, owner: row['Owner'] });

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

    // Funnel: count deals at each stage (active + closed Won in last 30d)
    const funnel = FUNNEL_STAGES.map(stage => {
      const count = (stage === 'Won')
        ? all.filter(r => r['Stage'] === 'Won' && r['Created Date'] && new Date(r['Created Date']) >= thirtyDaysAgo).length
        : stageCounts[stage] || 0;
      return { stage, count, value: stageValues[stage] || 0 };
    }).filter(f => f.count > 0);

    // Conversion rate: leads that reached Proposal Sent / total active+won(30d)
    const proposalReached = (stageCounts['Proposal Sent'] || 0)
      + (stageCounts['Negotiation'] || 0)
      + all.filter(r => r['Stage'] === 'Won').length;
    const totalEntered = active.length + all.filter(r => r['Stage'] === 'Won').length;
    const proposalConvRate = totalEntered > 0
      ? +((proposalReached / totalEntered) * 100).toFixed(1)
      : 0;

    const wonThisWeek = all.filter(r =>
      r['Stage'] === 'Won' && r['Created Date'] && new Date(r['Created Date']) >= sevenDaysAgo
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

if (process.argv[1].endsWith('gtm-report.js')) {
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
