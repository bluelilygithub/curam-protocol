'use strict';

const pino = require('pino');

// Base logger. Every other logger in the app (request-scoped child loggers
// from requestContext.js) derives from this one, so a single LOG_LEVEL env
// var controls verbosity everywhere.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
