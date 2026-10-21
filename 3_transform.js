import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { buildUpdate } from './transform.js';

const deals = JSON.parse(readFileSync('deals_raw.json', 'utf8'));
const now = Date.now();

const updates = [];
const rejected = [];
for (const d of deals) {
  const { update, rejected: bad } = buildUpdate(d, now);
  if (update) updates.push(update);
  else rejected.push(bad);
}

writeFileSync('deals_updates.json', JSON.stringify(updates, null, 2));
for (const r of rejected) appendFileSync('rejected.jsonl', JSON.stringify(r) + '\n');

const bySource = {};
for (const u of updates) {
  bySource[u.properties.deal_source] = (bySource[u.properties.deal_source] || 0) + 1;
}
console.log(`prepared ${updates.length}, rejected ${rejected.length}`);
console.log('by source:', bySource);