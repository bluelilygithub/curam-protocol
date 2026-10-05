'use strict';

// Gated on SENTRY_DSN — a no-op module (init() does nothing, captureException
// is a harmless no-op) until that env var is set on Railway, so nothing
// breaks or requires config before a Sentry project actually exists.
const enabled = Boolean(process.env.SENTRY_DSN);

// What people look up (a place in Garden Planner's wizard) is theirs. Even though the lookup sends its text in a POST body, Sentry's HTTP
// instrumentation records URLs (ours, and the outbound call to the geocoder, whose URL carries the text), so those are scrubbed here:
// anything after "?" is dropped from events, transactions, spans and breadcrumbs that mention these endpoints, and request bodies with it.
function sensitiveUrls(env = process.env) {
  // api.maptiler.com: the outbound tile URL carries the MapTiler key as ?key=, which must never reach an error report
  const list = ['/api/geocode', 'nominatim.openstreetmap.org', 'api.maptiler.com'];
  try { if (env.NOMINATIM_URL) list.push(new URL(env.NOMINATIM_URL).host); } catch { /* not a URL: ignore */ }
  return list;
}
const isSensitive = (u, env) => typeof u === 'string' && sensitiveUrls(env).some((p) => u.includes(p));
const stripQuery = (u) => u.split('?')[0];
const URL_KEYS = ['http.url', 'url', 'url.full', 'http.target', 'http.query', 'url.query', 'query', 'http.query_string'];

/** Remove lookup text from a Sentry event / transaction. Mutates and returns it. */
function scrubEvent(event, env = process.env) {
  if (!event || typeof event !== 'object') return event;
  const req = event.request;
  if (req && isSensitive(req.url, env)) {
    req.url = stripQuery(req.url);
    delete req.query_string;
    delete req.data;
    delete req.cookies;
  }
  if (isSensitive(event.transaction, env)) event.transaction = stripQuery(event.transaction);
  const scrubData = (data) => {
    if (!data || typeof data !== 'object') return;
    const touches = URL_KEYS.some((k) => isSensitive(data[k], env));
    for (const k of URL_KEYS) {
      if (typeof data[k] === 'string' && isSensitive(data[k], env)) data[k] = stripQuery(data[k]);
    }
    if (touches) for (const k of ['http.query', 'url.query', 'query', 'http.query_string']) delete data[k];
  };
  for (const span of event.spans ?? []) {
    if (isSensitive(span.description, env)) span.description = stripQuery(span.description);
    scrubData(span.data);
  }
  scrubData(event.contexts?.trace?.data);
  for (const b of event.breadcrumbs ?? []) scrubData(b.data);
  return event;
}

let Sentry = null;
if (enabled) {
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => { scrubEvent({ breadcrumbs: [crumb] }); return crumb; },
  });
}

function captureException(err, extra) {
  if (!enabled) return;
  Sentry.captureException(err, extra ? { extra } : undefined);
}

async function flush(timeoutMs) {
  if (!enabled) return true;
  return Sentry.flush(timeoutMs);
}

// Must be mounted after all routes, before the final error-handling
// middleware, per Sentry's Express integration contract.
function setupExpressErrorHandler(app) {
  if (!enabled) return;
  Sentry.setupExpressErrorHandler(app);
}

module.exports = { enabled, captureException, setupExpressErrorHandler, flush, scrubEvent };
