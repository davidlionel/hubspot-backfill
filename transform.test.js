import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpdate, seeded, SOURCES, REPS } from './transform.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const DAY = 86400000;

const deal = (o) => ({
  id: o.id ?? '1001',
  properties: {
    dealstage: o.stage ?? 'closedwon',
    amount: String(o.amount ?? 10000),
    createdate: o.created ?? '2026-09-14T00:00:00Z',
    closedate: o.closed,
  },
});

test('seeded() is deterministic across calls', () => {
  assert.equal(seeded('1001', 'src'), seeded('1001', 'src'));
  assert.notEqual(seeded('1001', 'src'), seeded('1002', 'src'));
});

test('seeded() stays within [0,1)', () => {
  for (let i = 0; i < 5000; i++) {
    const v = seeded(String(i), 'x');
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

// Bug 2 from the 19 Oct review.
test('an open deal with a future close date never gets a future create date', () => {
  const { update, rejected } = buildUpdate(
    deal({ stage: 'qualifiedtobuy', closed: new Date(NOW + 60 * DAY).toISOString() }), NOW);
  assert.ok(update, rejected && JSON.stringify(rejected));
  assert.ok(Date.parse(update.properties.imported_create_date) <= NOW,
    'create date must not be in the future');
});

test('a closed deal never gets a create date after its close date', () => {
  for (let i = 0; i < 300; i++) {
    const closed = new Date(NOW - (1 + i) * DAY).toISOString();
    // Half collapsed into Sept 2026, half with a real spread-out create date.
    const created = i % 2
      ? '2026-09-14T00:00:00Z'
      : new Date(NOW - (2 + i) * DAY).toISOString();
    const { update } = buildUpdate(deal({ id: String(2000 + i), closed, created }), NOW);
    assert.ok(Date.parse(update.properties.imported_create_date) <= Date.parse(closed),
      `record ${2000 + i} created after it closed`);
  }
});

// The genuinely impossible case: a deal marked CLOSED whose close date has
// not happened yet. Deriving backward from it lands the create date in the
// future, so it must be rejected rather than written.
test('a closed deal with a close date in the future is rejected', () => {
  const { update, rejected } = buildUpdate(
    deal({ stage: 'closedwon', closed: new Date(NOW + 400 * DAY).toISOString() }), NOW);
  assert.equal(update, undefined);
  assert.ok(rejected);
  assert.match(rejected.reason, /future or after close/);
});

test('every output uses a valid enum option and a YYYY-MM-DD date', () => {
  for (let i = 0; i < 300; i++) {
    const { update } = buildUpdate(
      deal({ id: String(3000 + i), closed: new Date(NOW - (5 + i) * DAY).toISOString() }), NOW);
    assert.ok(SOURCES.includes(update.properties.deal_source));
    assert.ok(REPS.includes(update.properties.rep_name));
    assert.match(update.properties.imported_create_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['true', 'false'].includes(update.properties.skipped_qualification));
  }
});

// Bug 4, as a statistical check.
test('planted cycle times keep their intended ordering', () => {
  const buckets = {};
  for (let i = 0; i < 2000; i++) {
    const closed = new Date(NOW - (30 + (i % 500)) * DAY);
    const created = i % 4
      ? '2026-09-14T00:00:00Z'
      : new Date(closed.getTime() - (120 + (i % 300)) * DAY).toISOString();
    const { update } = buildUpdate(
      deal({ id: String(9000 + i), amount: 10000, closed: closed.toISOString(), created }), NOW);
    const days = (closed - Date.parse(update.properties.imported_create_date)) / DAY;
    (buckets[update.properties.deal_source] ||= []).push(days);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const order = Object.entries(buckets)
    .map(([k, v]) => [k, mean(v)])
    .sort((a, b) => a[1] - b[1])
    .map((e) => e[0]);
  assert.deepEqual(order, ['Referral', 'Paid Search', 'Organic', 'Outbound']);
});

// Bug 4 again, encoded directly. The design decision is that EVERY closed
// deal gets a planted cycle. Copying a clean record's original createdate
// across is what diluted the pattern.
test('a closed deal with a clean create date still gets the planted cycle, not its original date', () => {
  const closed = new Date(NOW - 100 * DAY);
  const originalCreate = new Date(closed.getTime() - 400 * DAY).toISOString();
  const { update } = buildUpdate(
    deal({ id: '7777', stage: 'closedlost', closed: closed.toISOString(), created: originalCreate }), NOW);

  assert.notEqual(update.properties.imported_create_date, originalCreate.slice(0, 10),
    'original createdate was copied across instead of planting a cycle');

  const days = (closed - Date.parse(update.properties.imported_create_date)) / DAY;
  assert.ok(days > 20 && days < 120, `planted cycle out of range: ${days}d`);
});

// Bug 5, found in live use on 21 Oct. 39 open deals in the portal carry a
// projected close date that has already passed. A projection is not a fact,
// so an overdue open deal must still get a create date rather than being
// dropped. Treating it as a ceiling silently excluded 22 records.
test('an overdue open deal is still processed, not rejected', () => {
  const { update, rejected } = buildUpdate(
    deal({ id: '8888', stage: 'qualifiedtobuy', closed: new Date(NOW - 300 * DAY).toISOString() }), NOW);
  assert.ok(update, `overdue open deal was dropped: ${JSON.stringify(rejected)}`);
  assert.ok(Date.parse(update.properties.imported_create_date) <= NOW);
});