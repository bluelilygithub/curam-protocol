'use strict';

// One place to build a complete Shares or Finance Compliance Advisory stack from an app config. Routes, cron,
// adapter and spend checks all come from the shared modules; only the config differs. See
// docs/shares-compliance.md and docs/finance-compliance.md.

const { configFor, SHARES, FINANCE } = require('./config');
const { createService } = require('./service');
const { createRoutes } = require('./routes');
const { createCron } = require('./cron');
const { createSpend } = require('./spend');
const { createPrompt } = require('./prompt');
const { createReportBuilder } = require('./report');
const { createPdfBuilder } = require('./pdf');

function createAdvisory(appOrConfig) {
  const config = typeof appOrConfig === 'string' ? configFor(appOrConfig) : appOrConfig;
  const service = createService(config);
  return {
    config,
    service,
    spend: createSpend(config),
    prompt: createPrompt(config),
    reports: createReportBuilder(config),
    pdf: createPdfBuilder(config),
    router: createRoutes({ config, service }),
    cron: createCron({ config, service }),
    // The recycle-bin adapter registers itself with the bin; load it only when the bin is actually used.
    adapter: () => require('./recycleAdapter').createRecycleAdapter(config),
  };
}

module.exports = {
  SHARES, FINANCE, configFor, createAdvisory,
  createService, createRoutes, createCron, createSpend,
  createPrompt, createReportBuilder, createPdfBuilder,
};
