'use strict';

// /api/shares/compliance — the admin-only Shares Compliance Advisory tab. Mounted with requireFeature('shares')
// and requireAdmin BEFORE /api/shares in server/index.js. See docs/shares-compliance.md.

module.exports = require('../services/complianceAdvisory/instances').getRouter('shares');
