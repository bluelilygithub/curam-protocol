'use strict';

const { randomUUID } = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const logger = require('../lib/logger');

const als = new AsyncLocalStorage();

// Tags every log line emitted during a request with the same requestId (and
// userId once requireAuth has run), so `grep requestId` reconstructs the
// full lifecycle of one request across route handlers, services, and the DB
// wrapper — instead of isolated, uncorrelated console lines.
function requestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const child = logger.child({ requestId });
  res.setHeader('x-request-id', requestId);
  req.requestId = requestId;
  als.run({ requestId, logger: child }, () => next());
}

// Called by requireAuth once req.user is known, so subsequent log lines in
// the same request (DB queries, service calls) carry userId too.
function attachUserToLogContext(userId) {
  const store = als.getStore();
  if (store) {
    store.logger = store.logger.child({ userId });
  }
}

// Returns the request-scoped child logger when called inside a request
// (anywhere down the async call chain — services, cron-triggered work
// spawned from a request, etc). Falls back to the bare base logger outside
// a request context (startup code, cron jobs with no originating request).
function getLogger() {
  return als.getStore()?.logger || logger;
}

module.exports = { requestContext, getLogger, attachUserToLogContext };
