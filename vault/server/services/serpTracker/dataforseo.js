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
        // DataForSEO's own explanation (for example "access denied" or "payment required") is safe to show: it never echoes the request headers
        let why = '';
        try { const j = await res.json(); why = String((j && (j.status_message || (j.tasks && j.tasks[0] && j.tasks[0].status_message))) || '').replace(/\s+/g, ' ').slice(0, 200); } catch { /* no readable body */ }
        throw new DataForSeoError(`DataForSEO answered HTTP ${res.status}.${hint}${why ? ` It said: ${why}` : ''}`, { status: res.status, code: 'HTTP' });
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

// --- Google organic SERP, Standard Queue (stage 2). Endpoints checked against the DataForSEO docs on 2026-11-06:
//   POST /v3/serp/google/organic/task_post              body = [ { keyword, location_name, language_code, device, depth, priority, load_async_ai_overview, tag } ]
//                                                       a new task answers task status 20100; the charge is made HERE, per SERP of up to 10 results
//   GET  /v3/serp/google/organic/task_get/advanced/<id> free to read, valid 30 days; task status 20000 = result ready
// "Still being worked on" task codes are 40601 (handed) and 40602 (in queue) per the DataForSEO errors list; the docs pages read did not
// show them, so any other task code is treated as a failure rather than "wait longer". Polling uses task_get (free), not tasks_ready, whose
// shape the docs pages read did not show.
const TASK_CREATED = 20100;
const TASK_OK = 20000;
const TASK_PENDING = new Set([40601, 40602]);

/**
 * Post ONE search task. @returns {{ taskId, costUsd }}  (costUsd is what this call charged)
 * @param task { keyword, locationName, languageCode, device, depth, loadAiOverview, tag }
 */
async function postSerpTask(task, opts = {}) {
  const body = [{
    keyword: task.keyword,
    location_name: task.locationName,
    language_code: task.languageCode,
    device: task.device,
    depth: task.depth,
    priority: 1, // normal = the cheapest
    ...(task.loadAiOverview ? { load_async_ai_overview: true } : {}),
    ...(task.tag ? { tag: String(task.tag).slice(0, 255) } : {}),
  }];
  const json = await request({ ...opts, method: 'POST', path: '/v3/serp/google/organic/task_post', body });
  const t = json && json.tasks && json.tasks[0];
  if (!t || t.status_code !== TASK_CREATED || !t.id) {
    throw new DataForSeoError(`DataForSEO did not accept the search task (status ${t ? t.status_code : 'none'}: ${String((t && t.status_message) || '').slice(0, 200)}).`, { code: 'TASK_REJECTED' });
  }
  return { taskId: t.id, costUsd: Number(t.cost) || 0 };
}

/** Read one task. @returns {{ ready: boolean, result?: object, raw?: object }} ; a task that failed on DataForSEO's side throws. */
async function getSerpTask(taskId, opts = {}) {
  const json = await request({ ...opts, method: 'GET', path: `/v3/serp/google/organic/task_get/advanced/${encodeURIComponent(taskId)}` });
  const t = json && json.tasks && json.tasks[0];
  if (!t) throw new DataForSeoError('DataForSEO sent no task in its answer.', { code: 'BAD_BODY' });
  if (t.status_code === TASK_OK) return { ready: true, result: t.result && t.result[0], raw: json };
  if (TASK_PENDING.has(t.status_code)) return { ready: false };
  throw new DataForSeoError(`DataForSEO task status ${t.status_code}: ${String(t.status_message || '').slice(0, 200)}`, { code: 'TASK_FAILED' });
}

/** Poll a task until it is ready or `maxMs` passes. Returns the getSerpTask answer, or { ready: false, timedOut: true }. */
async function waitForSerpTask(taskId, { intervalMs = 10000, maxMs = 60 * 60 * 1000, sleep = realSleep, now = Date.now, ...opts } = {}) {
  const started = now();
  for (;;) {
    const r = await getSerpTask(taskId, { ...opts, sleep });
    if (r.ready) return r;
    if (now() - started + intervalMs > maxMs) return { ready: false, timedOut: true };
    await sleep(intervalMs);
  }
}

module.exports = { request, getBalance, postSerpTask, getSerpTask, waitForSerpTask, hasCredentials, authHeader, DataForSeoError, BASE_URL, MAX_RETRIES };
