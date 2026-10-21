import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { hs } from './hubspot.js';

const PROPS = ['dealname', 'amount', 'dealstage', 'closedate', 'createdate', 'pipeline'];

const all = [];
let after;
let page = 0;

do {
  const qs = new URLSearchParams({ limit: '100', properties: PROPS.join(',') });
  if (after) qs.set('after', after);

  const { body } = await hs(`/crm/v3/objects/deals?${qs}`);
  all.push(...body.results);
  page++;

  const nextAfter = body.paging?.next?.after;

  // Guard against a cursor that does not advance. Without this a server-side
  // quirk turns into an infinite loop that quietly burns your rate limit.
  if (nextAfter && nextAfter === after) {
    throw new Error(`cursor did not advance past ${after}, stopping`);
  }
  after = nextAfter;

  console.log(`page ${page}: got ${body.results.length}, running total ${all.length}`);
} while (after);

writeFileSync('deals_raw.json', JSON.stringify(all, null, 2));
console.log(`\ndone: ${all.length} deals in ${page} pages`);