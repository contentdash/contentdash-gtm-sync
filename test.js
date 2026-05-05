// Unit tests — run with: node test.js
// No test framework needed; uses Node's built-in assert

import assert from 'assert';
import { isInternal, toMRRUSD, subItemAmount, SGD_TO_USD, INTERNAL_PATTERNS } from './stripe-report.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

// ── isInternal ──────────────────────────────────────────────────────────────

console.log('\nisInternal()');

test('blocks kentlacno email', () => {
  assert.strictEqual(isInternal('kentlacno@gmail.com'), true);
});
test('blocks sadriano email', () => {
  assert.strictEqual(isInternal('sadriano@example.com'), true);
});
test('blocks fleiremae email', () => {
  assert.strictEqual(isInternal('fleiremae@something.com'), true);
});
test('blocks test+ address', () => {
  assert.strictEqual(isInternal('admin+test+123@gmail.com'), true);
});
test('blocks @test. domain', () => {
  assert.strictEqual(isInternal('user@test.example.com'), true);
});
test('blocks test@ prefix', () => {
  assert.strictEqual(isInternal('test@something.com'), true);
});
test('blocks apasoquin@contentdash.app', () => {
  assert.strictEqual(isInternal('apasoquin@contentdash.app'), true);
});
test('blocks info@contentdash.app', () => {
  assert.strictEqual(isInternal('info@contentdash.app'), true);
});
test('allows real customer email', () => {
  assert.strictEqual(isInternal('client@acme.com'), false);
});
test('allows empty string', () => {
  assert.strictEqual(isInternal(''), false);
});
test('allows null/undefined gracefully', () => {
  assert.strictEqual(isInternal(null), false);
  assert.strictEqual(isInternal(undefined), false);
});
test('case-insensitive match', () => {
  assert.strictEqual(isInternal('KENTLACNO@Gmail.com'), true);
});

// ── toMRRUSD ────────────────────────────────────────────────────────────────

console.log('\ntoMRRUSD()');

test('USD passes through', () => {
  assert.strictEqual(toMRRUSD(100, 'USD'), 100);
});
test('SGD converts at correct rate', () => {
  assert.strictEqual(toMRRUSD(100, 'SGD'), 100 * SGD_TO_USD);
});
test('unknown currency returns 0', () => {
  assert.strictEqual(toMRRUSD(100, 'PHP'), 0);
});
test('zero amount USD', () => {
  assert.strictEqual(toMRRUSD(0, 'USD'), 0);
});
test('SGD_TO_USD constant is reasonable (0.6–0.9)', () => {
  assert.ok(SGD_TO_USD >= 0.6 && SGD_TO_USD <= 0.9, `SGD_TO_USD=${SGD_TO_USD} out of expected range`);
});

// ── subItemAmount ───────────────────────────────────────────────────────────

console.log('\nsubItemAmount()');

test('single item, qty 1', () => {
  const sub = { items: { data: [{ price: { unit_amount: 1000 }, quantity: 1 }] } };
  assert.strictEqual(subItemAmount(sub), 1000);
});
test('single item, qty 3', () => {
  const sub = { items: { data: [{ price: { unit_amount: 500 }, quantity: 3 }] } };
  assert.strictEqual(subItemAmount(sub), 1500);
});
test('multiple items summed', () => {
  const sub = { items: { data: [
    { price: { unit_amount: 1000 }, quantity: 2 },
    { price: { unit_amount: 500 }, quantity: 1 },
  ]}};
  assert.strictEqual(subItemAmount(sub), 2500);
});
test('null unit_amount defaults to 0', () => {
  const sub = { items: { data: [{ price: { unit_amount: null }, quantity: 1 }] } };
  assert.strictEqual(subItemAmount(sub), 0);
});
test('null quantity defaults to 1', () => {
  const sub = { items: { data: [{ price: { unit_amount: 800 }, quantity: null }] } };
  assert.strictEqual(subItemAmount(sub), 800);
});
test('empty items array', () => {
  const sub = { items: { data: [] } };
  assert.strictEqual(subItemAmount(sub), 0);
});

// ── GTM stale deal filter logic ──────────────────────────────────────────────

console.log('\nGTM stale deal filter (inline)');

const STALE_THRESHOLD = 5;
const mockRows = [
  { Account: 'Acme', Stage: 'ICP Fit', 'Days Since Last Contact': '6', Owner: 'Charlene', 'Overdue Next Step': 'N', 'Stuck Deal': 'N', Health: 'Green', 'Created Date': '', Value: '' },
  { Account: 'Beta', Stage: 'Replied', 'Days Since Last Contact': '3', Owner: 'Charlene', 'Overdue Next Step': 'Y', 'Stuck Deal': 'N', Health: 'Yellow', 'Created Date': '', Value: '500' },
  { Account: 'Gamma', Stage: 'Won', 'Days Since Last Contact': '10', Owner: 'Charlene', 'Overdue Next Step': 'N', 'Stuck Deal': 'N', Health: 'Green', 'Created Date': '', Value: '' },
  { Account: '', Stage: 'ICP Fit', 'Days Since Last Contact': '8', Owner: 'Charlene', 'Overdue Next Step': 'N', 'Stuck Deal': 'N', Health: 'Red', 'Created Date': '', Value: '' },
];

const CLOSED = new Set(['Won', 'Lost']);
const active = mockRows.filter(r => r.Account && !CLOSED.has(r.Stage));
const stale = active.filter(r => (parseInt(r['Days Since Last Contact']) || 0) > STALE_THRESHOLD);
const overdue = active.filter(r => String(r['Overdue Next Step']).toUpperCase() === 'Y');

test('active filter excludes Won and blank Account', () => {
  assert.strictEqual(active.length, 2); // Acme, Beta
});
test('stale filter: only Acme (6d > 5)', () => {
  assert.strictEqual(stale.length, 1);
  assert.strictEqual(stale[0].Account, 'Acme');
});
test('overdue next step: only Beta', () => {
  assert.strictEqual(overdue.length, 1);
  assert.strictEqual(overdue[0].Account, 'Beta');
});
test('stageValues accumulate correctly', () => {
  const stageValues = {};
  active.forEach(r => {
    const stage = r.Stage;
    const val = parseFloat(String(r.Value).replace(/[^0-9.]/g, '')) || 0;
    stageValues[stage] = (stageValues[stage] || 0) + val;
  });
  assert.strictEqual(stageValues['Replied'], 500);
  assert.strictEqual(stageValues['ICP Fit'] || 0, 0); // Acme has no value
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────`);
console.log(`Tests: ${passed + failed} | ✓ ${passed} passed | ${failed > 0 ? `✗ ${failed} FAILED` : '0 failed'}`);
if (failed > 0) process.exit(1);
