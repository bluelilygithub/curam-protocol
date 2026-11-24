'use strict';

// One service instance per app, shared by routes, cron and wrappers so the one-running guard is real.
// Heavy/database-aware pieces (routes, cron, recycle adapter) are loaded on demand: unit tests can require the
// prompt/report/service helpers without opening a PostgreSQL pool.

const { configFor } = require('./config');
const { createService } = require('./service');
const { createPrompt } = require('./prompt');
const { createReportBuilder } = require('./report');
const { createSpend } = require('./spend');
const { createPdfBuilder } = require('./pdf');

const cache = new Map();

function parts(app) {
  const key = String(app || '').toLowerCase();
  if (!cache.has(key)) {
    const config = configFor(key);
    cache.set(key, {
      config,
      service: createService(config),
      spend: createSpend(config),
      prompt: createPrompt(config),
      reports: createReportBuilder(config),
      pdf: createPdfBuilder(config),
    });
  }
  return cache.get(key);
}

function getRouter(app) {
  const p = parts(app);
  if (!p.router) {
    p.router = require('./routes').createRoutes({ config: p.config, service: p.service, pdf: p.pdf });
  }
  return p.router;
}

function getCron(app) {
  const p = parts(app);
  if (!p.cron) p.cron = require('./cron').createCron({ config: p.config, service: p.service });
  return p.cron;
}

function getAdapter(app) {
  const p = parts(app);
  if (!p.adapter) p.adapter = require('./recycleAdapter').createRecycleAdapter(p.config);
  return p.adapter;
}

module.exports = { parts, getRouter, getCron, getAdapter };
