import 'dotenv/config';
import { XeroClient } from 'xero-node';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.join(__dirname, '../xero-datapull/tokens.json');

function loadTokens() {
  // GitHub Actions: tokens stored as JSON secret
  if (process.env.XERO_TOKENS_JSON) {
    return JSON.parse(process.env.XERO_TOKENS_JSON);
  }
  // Local: tokens file from xero-datapull
  try {
    return JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
  } catch {
    throw new Error('Xero tokens not found. Run: cd ~/Projects/xero-datapull && npm run auth');
  }
}

async function buildClient() {
  const saved = loadTokens();
  if (!saved.tokenSet?.refresh_token) {
    throw new Error('Xero refresh token missing. Run: cd ~/Projects/xero-datapull && npm run auth');
  }

  const xero = new XeroClient({
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    redirectUris: [process.env.XERO_REDIRECT_URI],
    scopes: ['openid', 'profile', 'email', 'offline_access',
      'accounting.invoices.read', 'accounting.contacts.read'],
  });

  await xero.initialize();
  const fresh = await xero.refreshWithRefreshToken(
    process.env.XERO_CLIENT_ID,
    process.env.XERO_CLIENT_SECRET,
    saved.tokenSet.refresh_token,
  );
  await xero.setTokenSet(fresh);

  const updatedTokens = { ...saved, tokenSet: fresh, savedAt: new Date().toISOString() };

  if (process.env.XERO_TOKENS_JSON) {
    // CI: write fresh tokens to temp file so the workflow step can rotate the GitHub secret
    writeFileSync('/tmp/xero-tokens-fresh.json', JSON.stringify(updatedTokens, null, 2));
  } else {
    // Local: write directly to the tokens file
    writeFileSync(TOKENS_PATH, JSON.stringify(updatedTokens, null, 2));
  }
  return xero;
}

export async function getARSnapshot() {
  const xero = await buildClient();
  const tenants = await xero.updateTenants();
  const tenantId = tenants[0].tenantId;

  const today = new Date();
  const invoicesResp = await xero.accountingApi.getInvoices(
    tenantId, undefined, undefined,
    ['AUTHORISED'], ['ACCREC'], undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, true
  );

  const invoices = (invoicesResp.body.invoices || []).map(inv => {
    const due = new Date(inv.dueDateString || inv.dueDate);
    const daysOverdue = Math.floor((today - due) / (1000 * 60 * 60 * 24));
    return {
      invoiceNumber: inv.invoiceNumber,
      contact: inv.contact?.name || 'Unknown',
      amountDue: inv.amountDue,
      currency: inv.currencyCode,
      dueDate: inv.dueDateString || 'N/A',
      daysOverdue: Math.max(0, daysOverdue),
      status: daysOverdue > 30 ? '🔴 30+ days' : daysOverdue > 7 ? '🟡 7+ days' : '🟢 Current',
    };
  });

  const overdue = invoices.filter(i => i.daysOverdue > 0);
  const totalAR = invoices.reduce((s, i) => s + (i.amountDue || 0), 0);

  return { invoices, overdue, totalAR, asOf: today.toISOString().slice(0, 10) };
}

// Run standalone
if (process.argv[1].endsWith('ar-check.js')) {
  try {
    const ar = await getARSnapshot();
    console.log('\n=== XERO AR SNAPSHOT ===');
    console.log(`As of: ${ar.asOf} | Total AR: ${ar.totalAR}`);
    console.log(`Overdue: ${ar.overdue.length} invoices`);
    ar.overdue.forEach(i => {
      console.log(`  ${i.status} ${i.contact} — ${i.currency} ${i.amountDue} (due ${i.dueDate}, ${i.daysOverdue}d overdue)`);
    });
  } catch (e) {
    console.error(e.message);
  }
}
