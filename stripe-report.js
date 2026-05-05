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

  // Recent failed payments (last 30 days)
  const failedCharges = await stripe.paymentIntents.list({
    limit: 20,
    created: { gte: thirtyDaysAgo },
  });
  const failed = failedCharges.data.filter(p => p.status === 'requires_payment_method' || p.status === 'canceled');

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
