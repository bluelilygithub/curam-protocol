'use strict';

// BIP's one HTTP helper. Every module gets a timeout, a small retry for transient answers and its own minimum gap between calls,
// so a slow source cannot hold up the whole profile and an API is never hammered. URLs built from a person's domain go through
// Vault's SSRF guard (fetchPublicFile); fixed API endpoints use fetch directly.

const { fetchPublicFile } = require('../../utils/safeFetch');

const queues = new Map();
const lastCall = new Map();

const sleep = (ms, deps = {}) => new Promise((resolve) => (deps.sleep || setTimeout)(resolve, ms));

function limit(module, minGapMs, fn, deps = {}) {
  if (!minGapMs) return fn();
  const previous = queues.get(module) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const wait = Math.max(0, (lastCall.get(module) || 0) + minGapMs - Date.now());
    if (wait) await sleep(wait, deps);
    lastCall.set(module, Date.now());
    return fn();
  });
  queues.set(module, next.catch(() => {}));
  return next;
}

function timeoutSignal(ms) {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

function describe(res) {
  return `HTTP ${res.status}`;
}

/** JSON from a fixed API endpoint. Throws on a bad status after the retries are spent. */
async function fetchJson(url, { module = 'bip', method = 'GET', headers = {}, body = null, timeoutMs = 12000, retries = 2, minGapMs = 500, accepted = [200], deps = {} } = {}) {
  const doFetch = deps.fetch || fetch;
  return limit(module, minGapMs, async () => {
    let last;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await doFetch(url, {
          method,
          headers: { Accept: 'application/json', ...headers },
          body: body === null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
          signal: timeoutSignal(timeoutMs),
        });
        if (!accepted.includes(res.status)) {
          last = new Error(describe(res));
          last.status = res.status;
          if (res.status < 500 && res.status !== 429) throw last;
        } else {
          const text = await res.text();
          const json = parseJsonp(text);
          if (json === null) throw new Error('The service did not return JSON.');
          return json;
        }
      } catch (err) {
        last = err;
        if (err?.status && err.status < 500 && err.status !== 429) throw err;
      }
      if (attempt < retries) await sleep(250 * (attempt + 1), deps);
    }
    throw last || new Error('The service did not answer.');
  }, deps);
}

/** Parse a JSONP body (the ABR JSON API wraps its answers) or plain JSON. */
function parseJsonp(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* maybe JSONP */ }
  const start = s.indexOf('(');
  const end = s.lastIndexOf(')');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start + 1, end)); } catch { /* not JSONP either */ }
  }
  return null;
}

/** JSON from an address containing the person's domain: same SSRF checks as every other user-URL fetch in Vault. */
async function fetchPublicJson(url, { module = 'bip', timeoutMs = 12000, maxBytes = 2 * 1024 * 1024, deps = {} } = {}) {
  return limit(module, 300, async () => {
    const result = deps.fetchPublicFile
      ? await deps.fetchPublicFile(url, { maxBytes, timeoutMs, accept: 'application/json' })
      : await fetchPublicFile(url, { maxBytes, timeoutMs, accept: 'application/json' });
    const json = parseJsonp(Buffer.isBuffer(result.buffer) ? result.buffer.toString('utf8') : String(result.buffer || ''));
    if (json === null) throw new Error('The registry did not return JSON.');
    return { json, finalUrl: result.finalUrl };
  }, deps);
}

module.exports = { fetchJson, fetchPublicJson, parseJsonp, limit, sleep, timeoutSignal };
