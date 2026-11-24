'use strict';

// /api/finance/compliance — the admin-only Finance Compliance Advisory tab. Mounted with requireFeature('finance')
// and requireAdmin BEFORE /api/finance in server/index.js. See docs/finance-compliance.md.

module.exports = require('../services/complianceAdvisory/instances').getRouter('finance');
