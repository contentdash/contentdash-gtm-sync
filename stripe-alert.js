import 'dotenv/config';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Look back 65 minutes so hourly runs have a 5-minute overlap buffer
const LOOKBACK_SECONDS = 65 * 60;

async function getRecentFailures() {
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;

  // Fetch failed PaymentIntent events (covers one-time + subscription charges)
  const [piEvents, invEvents] = await Promise.all([
    stripe.events.list({ type: 'payment_intent.payment_failed', created: { gte: since }, limit: 50 }),
    stripe.events.list({ type: 'invoice.payment_failed', created: { gte: since }, limit: 50 }),
  ]);

  const failures = [];

  for (const ev of piEvents.data) {
    const pi = ev.data.object;
    const charge = pi.last_payment_error;
    let customerEmail = pi.receipt_email || null;
    if (!customerEmail && pi.customer) {
      try {
        const cus = await stripe.customers.retrieve(pi.customer);
        customerEmail = cus.email;
      } catch { /* ignore */ }
    }
    failures.push({
      type: 'payment',
      id: pi.id,
      customer: customerEmail || pi.customer || 'Unknown',
      amount: pi.amount ? `${(pi.amount / 100).toFixed(2)} ${pi.currency?.toUpperCase()}` : '?',
      error: charge?.message || charge?.code || 'Unknown error',
      card: charge?.payment_method_details?.card
        ? `${charge.payment_method_details.card.brand} ••••${charge.payment_method_details.card.last4}`
        : null,
      at: new Date(ev.created * 1000).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }),
      dashUrl: `https://dashboard.stripe.com/payments/${pi.id}`,
    });
  }

  for (const ev of invEvents.data) {
    const inv = ev.data.object;
    let customerEmail = inv.customer_email || null;
    if (!customerEmail && inv.customer) {
      try {
        const cus = await stripe.customers.retrieve(inv.customer);
        customerEmail = cus.email;
      } catch { /* ignore */ }
    }
    // Skip if already captured by PaymentIntent event
    if (inv.payment_intent && failures.some(f => f.id === inv.payment_intent)) continue;
    failures.push({
      type: 'invoice',
      id: inv.id,
      customer: customerEmail || inv.customer || 'Unknown',
      amount: inv.amount_due ? `${(inv.amount_due / 100).toFixed(2)} ${inv.currency?.toUpperCase()}` : '?',
      error: inv.last_finalization_error?.message || 'Payment failed',
      card: null,
      at: new Date(ev.created * 1000).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }),
      dashUrl: `https://dashboard.stripe.com/invoices/${inv.id}`,
    });
  }

  return failures;
}

async function postToSlack(failures) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) { console.log('⚠ SLACK_WEBHOOK_URL not set'); return; }

  const lines = failures.map(f =>
    `• *${f.customer}* — ${f.amount}${f.card ? ` · ${f.card}` : ''}\n  ↳ ${f.error} · <${f.dashUrl}|View in Stripe> · ${f.at} SGT`
  );

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `⚠️ ${failures.length} Stripe Payment Failure${failures.length !== 1 ? 's' : ''}` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: lines.join('\n\n') },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: 'Chase these today → log outcome in Trello' }],
        },
      ],
    }),
  });
  console.log(`✓ Slack alert sent for ${failures.length} failure${failures.length !== 1 ? 's' : ''}`);
}

async function getRecentCancellations() {
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;
  const events = await stripe.events.list({ type: 'customer.subscription.deleted', created: { gte: since }, limit: 50 });

  const cancellations = [];
  for (const ev of events.data) {
    const sub = ev.data.object;
    let customerEmail = null;
    if (sub.customer) {
      try {
        const cus = await stripe.customers.retrieve(sub.customer);
        customerEmail = cus.email;
      } catch { /* ignore */ }
    }
    const amount = sub.items?.data?.[0]?.price?.unit_amount;
    const currency = sub.currency?.toUpperCase() || sub.items?.data?.[0]?.price?.currency?.toUpperCase();
    const interval = sub.items?.data?.[0]?.price?.recurring?.interval || 'month';
    cancellations.push({
      customer: customerEmail || sub.customer || 'Unknown',
      amount: amount ? `${(amount / 100).toFixed(2)} ${currency}/${interval}` : '?',
      canceledAt: new Date(ev.created * 1000).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }),
      dashUrl: `https://dashboard.stripe.com/subscriptions/${sub.id}`,
    });
  }
  return cancellations;
}

async function postCancellationsToSlack(cancellations) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) { console.log('⚠ SLACK_WEBHOOK_URL not set'); return; }

  const lines = cancellations.map(c =>
    `• *${c.customer}* — ${c.amount} · <${c.dashUrl}|View in Stripe> · ${c.canceledAt} SGT`
  );

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `🚨 ${cancellations.length} Subscription Cancellation${cancellations.length !== 1 ? 's' : ''}` } },
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'Reach out within 24h — understand why, offer to help, log in Trello' }] },
      ],
    }),
  });
  console.log(`✓ Slack cancellation alert: ${cancellations.length}`);
}

async function getNewSubscriptions() {
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;
  const events = await stripe.events.list({ type: 'customer.subscription.created', created: { gte: since }, limit: 50 });

  const subs = [];
  for (const ev of events.data) {
    const sub = ev.data.object;
    let customerEmail = null;
    if (sub.customer) {
      try {
        const cus = await stripe.customers.retrieve(sub.customer);
        customerEmail = cus.email;
      } catch { /* ignore */ }
    }
    const amount = sub.items?.data?.[0]?.price?.unit_amount;
    const currency = sub.currency?.toUpperCase() || sub.items?.data?.[0]?.price?.currency?.toUpperCase();
    const interval = sub.items?.data?.[0]?.price?.recurring?.interval || 'month';
    subs.push({
      customer: customerEmail || sub.customer || 'Unknown',
      amount: amount ? `${(amount / 100).toFixed(2)} ${currency}/${interval}` : '?',
      at: new Date(ev.created * 1000).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }),
      dashUrl: `https://dashboard.stripe.com/subscriptions/${sub.id}`,
    });
  }
  return subs;
}

async function postNewSubsToSlack(subs) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) { console.log('⚠ SLACK_WEBHOOK_URL not set'); return; }

  const lines = subs.map(s =>
    `• *${s.customer}* — ${s.amount} · <${s.dashUrl}|View in Stripe> · ${s.at} SGT`
  );

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `🎉 New Subscriber${subs.length !== 1 ? 's' : ''}! (${subs.length})` } },
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'Send a welcome message and make them feel at home 🙌' }] },
      ],
    }),
  });
  console.log(`✓ Slack new sub alert: ${subs.length}`);
}

const [failures, cancellations, newSubs] = await Promise.all([
  getRecentFailures(), getRecentCancellations(), getNewSubscriptions(),
]);
console.log(`Checked last ${LOOKBACK_SECONDS / 60}min — ${failures.length} failure(s), ${cancellations.length} cancellation(s), ${newSubs.length} new sub(s)`);

if (newSubs.length > 0) {
  newSubs.forEach(s => console.log(`  new sub: ${s.customer} ${s.amount}`));
  await postNewSubsToSlack(newSubs);
}
if (failures.length > 0) {
  failures.forEach(f => console.log(`  payment: ${f.customer} ${f.amount} — ${f.error}`));
  await postToSlack(failures);
}
if (cancellations.length > 0) {
  cancellations.forEach(c => console.log(`  cancel: ${c.customer} ${c.amount}`));
  await postCancellationsToSlack(cancellations);
}
if (newSubs.length === 0 && failures.length === 0 && cancellations.length === 0) {
  console.log('✓ Nothing to report — Slack silent');
}
