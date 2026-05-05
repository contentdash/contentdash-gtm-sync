import 'dotenv/config';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// SGD→USD conversion rate (update periodically — last set 2026-05)
export const SGD_TO_USD = 0.74;

// Extract total amount in cents from a raw Stripe subscription
export function subItemAmount(s) {
  return s.items.data.reduce((sum, i) => sum + (i.price.unit_amount || 0) * (i.quantity || 1), 0);
}

// Convert monthly USD equivalent to USD, handling multi-currency
export function toMRRUSD(monthlyUSD, currency) {
  if (currency === 'USD') return monthlyUSD;
  if (currency === 'SGD') return monthlyUSD * SGD_TO_USD;
  return 0;
}

export const INTERNAL_PATTERNS = [
  'kentlacno', 'sadriano', 'fleiremae', 'test+', '@test.', 'test@',
  'apasoquin@contentdash.app', 'info@contentdash.app',
];
export const isInternal = email =>
  INTERNAL_PATTERNS.some(p => (email || '').toLowerCase().includes(p));

export async function getStripeSnapshot() {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

  // Step 1: Fetch active subscriptions
  const allActiveSubs = await stripe.subscriptions.list({ status: 'active', limit: 100 });

  const subscriptions = allActiveSubs.data.map(s => ({
    id: s.id,
    customer: s.customer,
    status: s.status,
    created: s.created,
    amount: subItemAmount(s),
    currency: s.currency.toUpperCase(),
    interval: s.items.data[0]?.price?.recurring?.interval || 'one_time',
    currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString().slice(0, 10),
  }));

  // Step 2: Resolve customer emails for active subs
  const activeCustomerIds = [...new Set(subscriptions.map(s => s.customer))];
  const customerMap = {};
  await Promise.all(activeCustomerIds.map(async id => {
    try {
      const c = await stripe.customers.retrieve(id);
      customerMap[id] = c.email || c.name || id;
    } catch { customerMap[id] = id; }
  }));

  // Step 3: Enrich + filter internal accounts
  const enriched = subscriptions
    .map(s => ({
      ...s,
      customerName: customerMap[s.customer] || s.customer,
      monthlyUSD: s.interval === 'year'
        ? +(s.amount / 100 / 12).toFixed(2)
        : +(s.amount / 100).toFixed(2),
    }))
    .filter(s => !isInternal(s.customerName));

  const totalMRR = enriched.reduce((sum, s) => sum + toMRRUSD(s.monthlyUSD, s.currency), 0);

  // Step 4: Parallelize all remaining independent Stripe calls
  const [failedIntentsResp, recentChargesResp, cancelEventsResp] = await Promise.all([
    stripe.paymentIntents.list({ limit: 20, created: { gte: thirtyDaysAgo } }),
    stripe.charges.list({ limit: 50, created: { gte: thirtyDaysAgo } }),
    // Use Events API — captures subs canceled recently regardless of when they were created
    // (the status:canceled + created filter is wrong: it matches subscription creation date, not cancel date)
    stripe.events.list({ type: 'customer.subscription.deleted', created: { gte: thirtyDaysAgo }, limit: 50 }),
  ]);

  // Failed payments
  const failedRaw = failedIntentsResp.data.filter(p =>
    p.status === 'requires_payment_method' || p.status === 'canceled'
  );
  const failedCustIds = [...new Set(failedRaw.map(p => p.customer).filter(Boolean))];
  const failedCustMap = { ...customerMap };
  await Promise.all(failedCustIds.filter(id => !failedCustMap[id]).map(async id => {
    try {
      const c = await stripe.customers.retrieve(id);
      failedCustMap[id] = c.email || c.name || id;
    } catch { failedCustMap[id] = id; }
  }));
  const failed = failedRaw
    .filter(p => !isInternal(failedCustMap[p.customer] || ''))
    .map(p => ({
      customer: failedCustMap[p.customer] || p.customer || 'Unknown',
      amount: p.amount ? `${p.currency?.toUpperCase()} ${(p.amount / 100).toFixed(2)}` : 'unknown amount',
      date: new Date(p.created * 1000).toISOString().slice(0, 10),
    }));

  // Collected last 30 days
  const collected = recentChargesResp.data
    .filter(c => c.paid && !c.refunded)
    .reduce((sum, c) => sum + c.amount / 100, 0);

  // New subscriptions — filter from already-fetched active list (no extra API call)
  const newSubDetails = subscriptions
    .filter(s => s.created >= thirtyDaysAgo && !isInternal(customerMap[s.customer] || s.customer))
    .map(s => ({
      customer: customerMap[s.customer] || s.customer,
      monthlyUSD: s.interval === 'year'
        ? +(s.amount / 100 / 12).toFixed(2)
        : +(s.amount / 100).toFixed(2),
      currency: s.currency,
    }));
  const newMRR = newSubDetails.reduce((sum, s) => sum + toMRRUSD(s.monthlyUSD, s.currency), 0);

  // Churned subscriptions via Events API (correct: matches cancel date, not creation date)
  const churnedRaw = cancelEventsResp.data.map(e => e.data.object);
  const churnedCustIds = [...new Set(churnedRaw.map(s => s.customer).filter(Boolean))];
  const churnedCustMap = { ...customerMap };
  await Promise.all(churnedCustIds.filter(id => !churnedCustMap[id]).map(async id => {
    try {
      const c = await stripe.customers.retrieve(id);
      churnedCustMap[id] = c.email || c.name || id;
    } catch { churnedCustMap[id] = id; }
  }));
  const churnedSubs = churnedRaw
    .filter(s => !isInternal(churnedCustMap[s.customer] || ''))
    .map(s => {
      const amount = subItemAmount(s);
      const interval = s.items.data[0]?.price?.recurring?.interval || 'month';
      const monthlyUSD = interval === 'year'
        ? +(amount / 100 / 12).toFixed(2)
        : +(amount / 100).toFixed(2);
      return { customer: churnedCustMap[s.customer] || s.customer, monthlyUSD, currency: s.currency.toUpperCase() };
    });
  const churnedMRR = churnedSubs.reduce((sum, s) => sum + toMRRUSD(s.monthlyUSD, s.currency), 0);

  return {
    subscriptions: enriched,
    totalMRR: +totalMRR.toFixed(2),
    subscriberCount: enriched.length,
    collectedLast30Days: +collected.toFixed(2),
    failedPayments: failed.length,
    failedDetails: failed,
    growth: {
      newSubs: newSubDetails.length,
      newMRR: +newMRR.toFixed(2),
      newSubDetails,
      churnedSubs: churnedSubs.length,
      churnedMRR: +churnedMRR.toFixed(2),
      netMRRChange: +(newMRR - churnedMRR).toFixed(2),
    },
    asOf: new Date().toISOString().slice(0, 10),
  };
}

// Run standalone
if (process.argv[1].endsWith('stripe-report.js')) {
  const snap = await getStripeSnapshot();
  console.log('\n=== STRIPE SNAPSHOT ===');
  console.log(`As of: ${snap.asOf}`);
  console.log(`Total MRR (USD equiv): $${snap.totalMRR}`);
  console.log(`Subscribers: ${snap.subscriberCount}`);
  console.log(`Collected last 30 days: $${snap.collectedLast30Days}`);
  console.log(`Failed payments: ${snap.failedPayments}`);
  console.log(`Growth (30d): +${snap.growth.newSubs} new ($${snap.growth.newMRR} MRR) | -${snap.growth.churnedSubs} churned ($${snap.growth.churnedMRR} MRR) | net $${snap.growth.netMRRChange}`);
  if (snap.growth.newSubDetails.length) {
    console.log('New subscribers:');
    snap.growth.newSubDetails.forEach(s => console.log(`  ${s.customer} — ~$${s.monthlyUSD}/mo`));
  }
  console.log('\nActive subscriptions:');
  snap.subscriptions.forEach(s => {
    console.log(`  ${s.customerName} — ${s.currency} ${s.amount / 100}/${s.interval} (~$${s.monthlyUSD}/mo)`);
  });
}
