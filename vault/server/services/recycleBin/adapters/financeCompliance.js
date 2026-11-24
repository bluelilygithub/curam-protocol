'use strict';

// How the recycle bin puts back a deleted Finance Compliance report (report row + source snapshots).
// DELETE /api/finance/compliance/reports/:id moves both in one transaction. See docs/recycle-bin.md and
// docs/finance-compliance.md.

const adapter = require('../../complianceAdvisory/instances').getAdapter('finance');

module.exports = adapter;
