// Joins the raw read with the transformed updates into one flat CSV.
import { readFileSync, writeFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync('deals_raw.json', 'utf8'));
const upd = new Map(
  JSON.parse(readFileSync('deals_updates.json', 'utf8')).map((u) => [u.id, u.properties])
);

const COLS = ['id','dealname','amount','dealstage','closedate',
  'imported_create_date','deal_source','rep_name','skipped_qualification'];

// Quote everything, double embedded quotes. Deal names are full of commas.
const esc = (v) => (v === null || v === undefined || v === '') ? '' : `"${String(v).replace(/"/g,'""')}"`;

const lines = [COLS.join(',')];
for (const d of raw) {
  const p = d.properties ?? {};
  const u = upd.get(d.id) ?? {};
  lines.push([esc(d.id), esc(p.dealname), esc(p.amount), esc(p.dealstage),
    esc(p.closedate ? p.closedate.slice(0,10) : ''), esc(u.imported_create_date),
    esc(u.deal_source), esc(u.rep_name), esc(u.skipped_qualification)].join(','));
}

writeFileSync('deals.csv', lines.join('\n') + '\n');
console.log(`wrote deals.csv: ${raw.length} rows, ${upd.size} with transform data`);