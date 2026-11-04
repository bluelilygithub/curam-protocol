'use strict';

// The model, the logger and DomScan, as one bundle the routes use. DOMAIN_PROVIDER=fake swaps in fakeProviders.js (no keys, no credits,
// repeatable answers) for trying the page and for tests. Anything else is the real thing.

function getProviders() {
  if (process.env.DOMAIN_PROVIDER === 'fake') return require('./fakeProviders');
  const { domscan, statusFor } = require('./domscan');
  return {
    getModels: require('../modelResolver').getModelsForUser,
    callModel: require('../callModel').callModel,
    logUsage: require('../../utils/logUsage').logUsage,
    statusFor,
    domscan,
    fake: false,
  };
}

module.exports = { getProviders };
