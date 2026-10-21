import 'dotenv/config';
import { readFileSync, appendFileSync } from 'node:fs';
import { hs, rateInfo } from './hubspot.js';

const updates = JSON.parse(readFileSync('deals_updates.json', 'utf8'));

const BATCH_SIZE = 100; // HubSpot's hard limit on batch endpoints
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function deadLetter(rows, reason, status, attempts) {
  for (const row of rows) {
    appendFileSync(
      'failed_writes.jsonl',
      JSON.stringify({
        ts: new Date().toISOString(),
        record_id: row.id,
        payload: row, // the full payload, so this is replayable
        error: reason,
        status: status ?? null,
        retry_count: attempts,
      }) + '\n'
    );
  }
}

async function writeBatch(batch, attempt = 1) {
  try {
    const { status, body } = await hs('/crm/v3/objects/deals/batch/update', {
      method: 'POST',
      body: JSON.stringify({ inputs: batch }),
    });

    // Reconcile by what came BACK, not by trusting the error report.
    // 200 = all good. 207 = some failed, and those failures live in an
    // `errors` array inside a response that res.ok already called success.
    const okIds = new Set((body?.results ?? []).map((r) => String(r.id)));
    const missed = batch.filter((r) => !okIds.has(String(r.id)));

    if (missed.length) {
      const detail = JSON.stringify(body?.errors ?? body?.numErrors ?? 'unknown');
      deadLetter(missed, `partial failure (HTTP ${status}): ${detail}`, status, attempt - 1);
      console.log(`  HTTP ${status}: ${okIds.size} written, ${missed.length} to dead letter`);
    }

    return okIds.size;
  } catch (e) {
    if (e.retriable && attempt <= 4) {
      // Honor Retry-After when the server sends one, otherwise back off.
      const ra = Number(rateInfo().retryAfter);
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2 ** attempt * 1000;
      console.log(`  ${e.status}, waiting ${wait}ms (attempt ${attempt})`);
      await sleep(wait);
      return writeBatch(batch, attempt + 1);
    }
    deadLetter(batch, e.message, e.status, attempt - 1);
    console.log(`  PERMANENT FAIL: ${batch.length} rows to dead letter (${e.status})`);
    return 0;
  }
}

const batches = chunk(updates, BATCH_SIZE);
let written = 0;

for (const [i, batch] of batches.entries()) {
  written += await writeBatch(batch);

  const { remaining, interval, max } = rateInfo();
  console.log(
    `batch ${i + 1}/${batches.length} | ${written} written | rate ${remaining}/${max} left in ${interval}ms`
  );

  // Throttle off the headers, not a guessed sleep. They come back on every
  // response, so a well-behaved client never has to hit the limit to know
  // it is close.
  if (Number(remaining) < 20) {
    console.log('  near the limit, pausing for the interval');
    await sleep(Number(interval) || 10000);
  }
}

console.log(`\n${written} of ${updates.length} records updated in ${batches.length} batches`);

// Fail loudly on a shortfall. A script that exits 0 having done 80% of the
// job is the thing this whole sprint is about.
if (written !== updates.length) {
  console.error(`SHORTFALL: ${updates.length - written} records did not write. See failed_writes.jsonl`);
  process.exit(1);
}