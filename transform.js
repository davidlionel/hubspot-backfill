// Pure transform logic, no API calls and no secrets, so it can be unit tested.
export const REPS = ['Dana Whitfield', 'Marcus Hale', 'Priya Raman', 'Tom Becker', 'Alexis Cho'];
export const SOURCES = ['Paid Search', 'Organic', 'Outbound', 'Referral'];
export const BASE_CYCLE = { 'Paid Search': 55, 'Organic': 68, 'Outbound': 75, 'Referral': 40 };

const CLOSED_STAGES = new Set(['closedwon', 'closedlost']);
const DAY = 86400000;

export function seeded(id, salt) {
  let h = 2166136261;
  const s = `${id}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

// Returns { update } or { rejected }. Never both.
// `now` is injected rather than read from the clock, so tests are not
// time-dependent. A test that passes in October and fails in January is
// worse than no test.
export function buildUpdate(deal, now = Date.now()) {
  const id = deal.id;
  const p = deal.properties ?? {};
  const amount = Number(p.amount) || 0;
  const closed = p.closedate ? new Date(p.closedate) : null;
  const won = p.dealstage === 'closedwon';
  const isClosed = CLOSED_STAGES.has(p.dealstage);

  const source = SOURCES[Math.floor(seeded(id, 'src') * SOURCES.length)];
  const rep =
    won && seeded(id, 'star') < 0.30
      ? 'Dana Whitfield'
      : REPS[Math.floor(seeded(id, 'rep') * REPS.length)];

  let cycle = BASE_CYCLE[source] + Math.round((seeded(id, 'jit') - 0.5) * 30);
  if (amount > 50000) cycle += 20;
  if (cycle < 5) cycle = 5;

  const importedCreate =
    isClosed && closed
      ? new Date(closed.getTime() - cycle * DAY)
      : new Date(now - (10 + Math.round(seeded(id, 'open') * 80)) * DAY);

  // An OPEN deal's close date is a projection, not a fact. An overdue open
  // deal is perfectly coherent and its projected close date must not cap the
  // create date. Only a genuinely closed deal's close date is a real ceiling.
  const ceiling = isClosed && closed ? Math.min(now, closed.getTime()) : now;
  if (importedCreate.getTime() > ceiling) {
    return {
      rejected: {
        record_id: id,
        reason: 'create date in the future or after close date',
        derived: importedCreate.toISOString(),
        closedate: p.closedate ?? null,
      },
    };
  }

  return {
    update: {
      id,
      properties: {
        imported_create_date: importedCreate.toISOString().slice(0, 10),
        deal_source: source,
        rep_name: rep,
        skipped_qualification: won && seeded(id, 'skip') < 0.18 ? 'true' : 'false',
      },
    },
  };
}