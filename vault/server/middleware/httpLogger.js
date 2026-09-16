'use strict';

const { getLogger } = require('./requestContext');

// One line per completed request: method, path, status, duration. This is
// the first bit of real tracing — enough to answer "which requests are
// slow" and "what's the 429/5xx rate" without a separate APM tool.
function httpLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    getLogger()[level]({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
    }, 'request completed');
  });
  next();
}

module.exports = { httpLogger };
