# HubSpot deal backfill

A Node script that repairs 517 bulk-loaded deals in a HubSpot portal: paginated
reads, batch writes at 100 records per call, rate limiting driven by response
headers, partial-failure reconciliation, and a replayable dead-letter log.

The data is **synthetic** — generated deals in a HubSpot developer test account,
with deliberately planted patterns. No client data.

## The problem

A bulk load left the portal unqueryable:

- 389 of 517 deals had their create date collapsed to the load date, while close
  dates ran back to Feb 2025. Cycle time came out **negative**.
- All 517 deals were unassigned, so win rate by rep was impossible.
- `createdate` is read-only in HubSpot and no API call can move it.

The fix is the standard one for imported history: write the real date to a custom
property and point every query at that instead.

## Requirements

- Node 18 or higher (uses built-in `fetch` and `node:test`)
- A HubSpot developer test account and a private app token

## Setup

```bash
npm install
cp .env.example .env     # then paste your token in
```

## Running it

Scripts are numbered and run in order:

| Script | What it does |
| --- | --- |
| `1_create_properties.js` | Creates the four custom deal properties. Safe to re-run. |
| `2_read.js` | Paginated read of every deal to `deals_raw.json`. |
| `3_transform.js` | Builds the updates locally. No API calls, so it is free to iterate on. |
| `4_write.js` | Batch writes 100 at a time, with backoff and a dead-letter log. |
| `5_verify.js` | Samples records back out of HubSpot and compares them to what was sent. |
| `6_export_csv.js` | Flattens everything to `deals.csv` for loading into Postgres. |

```bash
node 1_create_properties.js
node 2_read.js
node 3_transform.js
node 4_write.js
node 5_verify.js
```

Expected: 517 deals in 6 pages, 517 prepared and 0 rejected, 517 of 517 written
in 6 batches, 0 mismatches.

## Tests

```bash
npm test
```

Nine unit tests against `transform.js`, which is pure and takes an injected clock
so the suite is not time-dependent. CI runs them on every pull request and fails
the build if `.env` is ever tracked. No credentials are used in CI.

## Three things this turned up

**Batch update returns HTTP 207 when only some records fail.** The request
succeeds, so a normal `res.ok` check calls it a win while the failures sit in an
`errors` array nobody read. This reconciles against the IDs that came back in
`results` rather than trusting the error report.

**A validation rule silently dropped 22 real records.** 39 open deals carried a
projected close date that had already passed, and the validation treated that
forecast as a hard ceiling on the derived create date. The check added to prevent
silent data loss caused it. Only a closed deal's close date is a fact.

**Four null amounts broke 60% of a window function result.** `ROW_NUMBER() OVER
(... ORDER BY amount DESC)` returned each rep's *blank* deal rather than their
largest, because Postgres sorts NULL ahead of every value on a descending order.
4 records out of 517, no error, and a completely plausible-looking answer.

## Notes

- `createdate` cannot be set through the API. `imported_create_date` holds the
  real value.
- Rep assignment is a custom property rather than `hubspot_owner_id`, which would
  need real HubSpot users and seats.
- Rate limiting reads `X-HubSpot-RateLimit-Remaining` and `-Interval-Milliseconds`,
  which are returned on every response, so the limit is never actually hit.