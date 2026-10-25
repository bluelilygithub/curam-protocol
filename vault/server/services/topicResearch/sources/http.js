'use strict';

// Topic Research: one small way to call the fixed, official APIs behind the news, search and community sources. The addresses are constants in
// each source (never text from a person), so the SSRF guard used for typed feed addresses is not needed here. What matters instead:
//   - a timeout and a size cap on every call;
//   - an error message that names the source and what went wrong in plain words, and NEVER carries the request address, headers or a key
//     (keys travel in headers and an error is shown to the person and logged);
//   - a failure comes back as a result a source can report, so one source being down never stops a run.

const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

/** An error whose message is safe to show. `status` is the HTTP status when there was one; `text` is a short piece of the body (never headers). */
class SourceError extends Error {
  constructor(message, { status = null, text = '' } = {}) {
    super(message);
    this.name = 'SourceError';
    this.status = status;
    this.text = text;
  }
}

async function request(fetchFn, label, url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetchFn(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new SourceError(`${label} took too long to answer`);
    throw new SourceError(`${label} could not be reached`);
  }
  let text;
  try { text = await res.text(); } catch { throw new SourceError(`${label} stopped answering part way`, { status: res.status }); }
  if (text.length > MAX_BYTES) throw new SourceError(`${label} sent more than expected`, { status: res.status });
  if (!res.ok) {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (res.status === 429) throw new SourceError(`${label} is busy (too many requests). Try again in a few minutes`, { status: 429, text: snippet });
    // Brave answers a bad key with 422 (code SUBSCRIPTION_TOKEN_INVALID), not 401
    const keyRefused = res.status === 401 || res.status === 403 || (res.status === 422 && /api key is invalid|SUBSCRIPTION_TOKEN_INVALID|token.{0,20}invalid/i.test(snippet));
    if (keyRefused) throw new SourceError(`${label} did not accept the key`, { status: res.status, text: snippet });
    throw new SourceError(`${label} answered with an error (${res.status})`, { status: res.status, text: snippet });
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new SourceError(`${label} sent something that could not be read`, { status: res.status, text: text.replace(/\s+/g, ' ').trim().slice(0, 120) }); }
  return { status: res.status, data };
}

const getJson = (fetchFn, label, url, opts) => request(fetchFn, label, url, { ...opts, method: 'GET' });
const postJson = (fetchFn, label, url, payload, opts = {}) => request(fetchFn, label, url, {
  ...opts, method: 'POST', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: JSON.stringify(payload),
});
const postForm = (fetchFn, label, url, fields, opts = {}) => request(fetchFn, label, url, {
  ...opts, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) }, body: new URLSearchParams(fields).toString(),
});

/** A source's failure as the result shape every source returns, so a run carries on. */
function failed(label, err) {
  const message = err instanceof SourceError ? err.message : `${label} failed unexpectedly`;
  return { items: [], errors: [{ source: label, message }], answered: 0 };
}

/**
 * Space calls out: at most one every `gapMs` (shared by everyone who uses this instance). Calls queue; none is dropped.
 * `now` and `sleep` are injectable so a test needs no real waiting.
 */
function createThrottle({ gapMs, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let last = -Infinity;
  let chain = Promise.resolve();
  return function throttled(fn) {
    const run = chain.then(async () => {
      const wait = last + gapMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };
}

module.exports = { SourceError, getJson, postJson, postForm, failed, createThrottle, MAX_BYTES };
