import 'dotenv/config';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function getStripeSnapshot() {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

  // Active subscriptions
  const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });

  const subscriptions = subs.data.map(s => ({
    id: s.id,
    customer: s.customer,
    status: s.status,
    amount: s.items.data.reduce((sum, i) => sum + (i.price.unit_amount || 0) * (i.quantity || 1), 0),
    currency: s.currency.toUpperCase(),
    interval: s.items.data[0]?.price?.recurring?.interval || 'one_time',
    currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString().slice(0, 10),
  }));

  // Resolve customer emails
  const customerIds = [...new Set(subscriptions.map(s => s.customer))];
  const customerMap = {};
  await Promise.all(customerIds.map(async id => {
    const c = await stripe.customers.retrieve(id);
    customerMap[id] = c.email || c.name || id;
  }));

  const INTERNAL_PATTERNS = [
    'kentlacno', 'sadriano', 'fleiremae', 'test+', '@test.', 'test@',
    'apasoquin@contentdash.app', 'info@contentdash.app',
  ];
  const isInternal = email => INTERNAL_PATTERNS.some(p => (email || '').toLowerCase().includes(p));

  const enriched = subscriptions
    .map(s => ({
      ...s,
      customerName: customerMap[s.customer] || s.customer,
      monthlyUSD: s.interval === 'year'
        ? +(s.amount / 100 / 12).toFixed(2)
        : +(s.amount / 100).toFixed(2),
    }))
    .filter(s => !isInternal(s.customerName));

  const totalMRR = enriched.reduce((sum, s) => {
    if (s.currency === 'USD') return sum + s.monthlyUSD;
    if (s.currency === 'SGD') return sum + s.monthlyUSD * 0.74;
    return sum;
  }, 0);

  // Recent failed payments (last 30 days) — resolve customer names
  const failedCharges = await stripe.paymentIntents.list({
    limit: 20,
    created: { gte: thirtyDaysAgo },
  });
  const failedRaw = failedCharges.data.filter(p => p.status === 'requires_payment_method' || p.status === 'canceled');
  const failedCustomerIds = [...new Set(failedRaw.map(p => p.customer).filter(Boolean))];
  const failedCustomerMap = {};
  await Promise.all(failedCustomerIds.map(async id => {
    try {
      const c = await stripe.customers.retrieve(id);
      failedCustomerMap[id] = c.email || c.name || id;
    } catch { failedCustomerMap[id] = id; }
  }));
  const failed = failedRaw
    .filter(p => !isInternal(failedCustomerMap[p.customer] || ''))
    .map(p => ({
      customer: failedCustomerMap[p.customer] || p.customer || 'Unknown',
      amount: p.amount ? `${p.currency?.toUpperCase()} ${(p.amount/100).toFixed(2)}` : 'unknown amount',
      date: new Date(p.created * 1000).toISOString().slice(0, 10),
    }));

  // Recent successful charges (last 30 days)
  const recentCharges = await stripe.charges.list({
    limit: 50,
    created: { gte: thirtyDaysAgo },
  });
  const collected = recentCharges.data
    .filter(c => c.paid && !c.refunded)
    .reduce((sum, c) => sum + c.amount / 100, 0);

  return {
    subscriptions: enriched,
    totalMRR: +totalMRR.toFixed(2),
    collectedLast30Days: +collected.toFixed(2),
    failedPayments: failed.length,
    failedDetails: failed,
    asOf: new Date().toISOString().slice(0, 10),
  };
}

// Run standalone
if (process.argv[1].endsWith('stripe-report.js')) {
  const snap = await getStripeSnapshot();
  console.log('\n=== STRIPE SNAPSHOT ===');
  console.log(`As of: ${snap.asOf}`);
  console.log(`Total MRR (USD equiv): $${snap.totalMRR}`);
  console.log(`Collected last 30 days: $${snap.collectedLast30Days}`);
  console.log(`Failed payments: ${snap.failedPayments}`);
  console.log('\nActive subscriptions:');
  snap.subscriptions.forEach(s => {
    console.log(`  ${s.customerName} — ${s.currency} ${s.amount/100}/${s.interval} (~$${s.monthlyUSD}/mo)`);
  });
}
