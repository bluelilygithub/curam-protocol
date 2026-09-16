'use strict';

// Gated on SENTRY_DSN — a no-op module (init() does nothing, captureException
// is a harmless no-op) until that env var is set on Railway, so nothing
// breaks or requires config before a Sentry project actually exists.
const enabled = Boolean(process.env.SENTRY_DSN);

let Sentry = null;
if (enabled) {
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
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

module.exports = { enabled, captureException, setupExpressErrorHandler, flush };
