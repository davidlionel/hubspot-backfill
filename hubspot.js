const BASE = 'https://api.hubapi.com';

let lastRate = {};

export async function hs(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    // Without this a hung connection hangs the script with no error, forever.
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // These come back on EVERY response, success or failure.
  lastRate = {
    max: res.headers.get('x-hubspot-ratelimit-max'),
    remaining: res.headers.get('x-hubspot-ratelimit-remaining'),
    interval: res.headers.get('x-hubspot-ratelimit-interval-milliseconds'),
    retryAfter: res.headers.get('retry-after'),
  };

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = new Error(`${res.status} ${text}`);
    err.status = res.status;
    // 429 and 5xx are worth retrying. A 400 or 404 is not: the data is wrong,
    // and retrying it for three days accomplishes nothing.
    err.retriable = res.status === 429 || res.status >= 500;
    throw err;
  }

  // 207 is "ok" to fetch but means SOME operations failed. Hand the status
  // up so the caller can tell 200 from 207 instead of assuming success.
  return { status: res.status, body };
}

export function rateInfo() {
  return lastRate;
}