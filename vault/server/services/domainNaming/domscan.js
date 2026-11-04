'use strict';

// The one place the Domain tool talks to DomScan (domains and social handles). Credits per the DomScan docs: /status 1 per request
// (any number of endings), /social 2 per handle. Used by the routes and by the generator.

const sets = require('../domainSets');

const DOMSCAN_BASE = 'https://domscan.net/v1';

function key() {
  const k = process.env.DOMSCAN_API_KEY;
  if (!k) throw new Error('DOMSCAN_API_KEY environment variable is not set on this server. Add it in Railway → Variables and redeploy.');
  return k;
}

// A lookup that does not answer within this is given up on, so one slow request can never hold the whole round.
const TIMEOUT_MS = 20000;

async function parse(res) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    throw new Error(`DomScan API key is invalid or unauthorised (HTTP ${res.status}). Check the key value in Railway → Variables.`);
  }
  if (res.status === 402) throw new Error('DomScan credits have run out for this period.');
  if (res.status === 429) throw new Error('DomScan is busy right now (too many requests). Try again in a moment.');
  if (!res.ok) throw new Error(body.message || body.error || `DomScan API error ${res.status}`);
  return body;
}

async function domscan(path, params = {}) {
  const url = new URL(`${DOMSCAN_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  try {
    return await parse(await fetch(url.toString(), { headers: { 'X-API-Key': key(), Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }));
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error(`DomScan did not answer within ${TIMEOUT_MS / 1000} seconds.`);
    throw e;
  }
}

/**
 * A name's endings. The service can skip some of the endings it was asked for, so any that are missing from the answer are asked for
 * again in a second request rather than silently left out. `maxAge` is how old a saved answer may be, in seconds (0 = a live lookup).
 */
async function statusFor(name, tldList, maxAge) {
  const first = await domscan('/status', { name, tlds: tldList, max_age: maxAge });
  const missing = sets.missingTlds(first, tldList.split(','));
  if (!missing.length) return first;
  try {
    const more = await domscan('/status', { name, tlds: missing.join(','), max_age: maxAge });
    return { ...first, results: [...(Array.isArray(first.results) ? first.results : []), ...(Array.isArray(more.results) ? more.results : [])] };
  } catch { return first; }
}

module.exports = { TIMEOUT_MS, DOMSCAN_BASE, key, domscan, statusFor };
