'use strict';

// SERP Tracker: DataForSEO client. Stage 1 has the account balance check only; the SERP calls arrive in stage 2/3 and go
// through the same `request` so they share the retry rules and never log a secret.
//
// Rules from the brief: build the Basic header from DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD in code; retry network errors, 5xx and
// 429 up to 3 times with exponential backoff; never retry any other 4xx; error text never carries a header, the login or the password.
// Endpoint checked against https://docs.dataforseo.com/v3/appendix/user_data/ on 2026-11-06: GET /v3/appendix/user_data, free,
// balance at tasks[0].result[0].money.balance, overall status_code 20000 = ok.

const BASE_URL = 'https://api.dataforseo.com';
const MAX_RETRIES = 3;
const BACKOFF_MS = 1000; // 1 s, 2 s, 4 s
const TIMEOUT_MS = 30000;
const OK_STATUS = 20000;

class DataForSeoError extends Error {
  constructor(message, { status = null, code = 'ERROR', retryable = false } = {}) {
    super(message);
    this.name = 'DataForSeoError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/** True when both credentials are set (so the page can say "not set up" instead of failing a run). */
function hasCredentials(env = process.env) {
  return Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD);
}

function authHeader(env = process.env) {
  if (!hasCredentials(env)) {
    throw new DataForSeoError('DataForSEO is not set up: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must both be set.', { code: 'NO_CREDENTIALS' });
  }
  return `Basic ${Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`, 'utf8').toString('base64')}`;
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One API call with the retry rules. Returns the parsed JSON body. Throws DataForSeoError (message safe to store and show).
 * @param opts { method, path, body, env, fetchImpl, sleep, retries, timeoutMs }
 */
async function request({ method = 'GET', path, body, env = process.env, fetchImpl = fetch, sleep = realSleep, retries = MAX_RETRIES, timeoutMs = TIMEOUT_MS }) {
  const header = authHeader(env);
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS * 2 ** (attempt - 1));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: header, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        last = new DataForSeoError(`DataForSEO answered HTTP ${res.status}.`, { status: res.status, code: 'HTTP', retryable: true });
        continue;
      }
      if (res.status >= 400) {
        // 4xx other than 429: our request is wrong or the login is; asking again will not help (and a bad login must not be hammered)
        const hint = res.status === 401 ? ' The login or password was refused.' : '';
        throw new DataForSeoError(`DataForSEO answered HTTP ${res.status}.${hint}`, { status: res.status, code: 'HTTP' });
      }
      let json;
      try { json = await res.json(); } catch { throw new DataForSeoError('DataForSEO sent an answer that was not JSON.', { status: res.status, code: 'BAD_BODY' }); }
      if (json && json.status_code != null && json.status_code !== OK_STATUS) {
        throw new DataForSeoError(`DataForSEO status ${json.status_code}: ${String(json.status_message || '').slice(0, 200)}`, { status: res.status, code: 'API_STATUS' });
      }
      return json;
    } catch (err) {
      if (err instanceof DataForSeoError) { if (err.retryable) { last = err; continue; } throw err; }
      // network failure or our own timeout (the error text may name the host, never a header)
      last = new DataForSeoError(err && err.name === 'AbortError' ? 'DataForSEO did not answer in time.' : 'Could not reach DataForSEO.', { code: 'NETWORK', retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

/** Account balance in US dollars. The call is free. @returns {{ balanceUsd: number, costUsd: number }} */
async function getBalance(opts = {}) {
  const json = await request({ ...opts, method: 'GET', path: '/v3/appendix/user_data' });
  const money = json && json.tasks && json.tasks[0] && json.tasks[0].result && json.tasks[0].result[0] && json.tasks[0].result[0].money;
  const balance = money ? Number(money.balance) : NaN;
  if (!Number.isFinite(balance)) throw new DataForSeoError('DataForSEO did not say what the balance is.', { code: 'BAD_BODY' });
  return { balanceUsd: balance, costUsd: Number(json.cost) || 0 };
}

module.exports = { request, getBalance, hasCredentials, authHeader, DataForSeoError, BASE_URL, MAX_RETRIES };
