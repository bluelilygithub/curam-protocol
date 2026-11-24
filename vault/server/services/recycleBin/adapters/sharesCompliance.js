'use strict';

// How the recycle bin puts back a deleted Shares Compliance report (report row + source snapshots).
// DELETE /api/shares/compliance/reports/:id moves both in one transaction. See docs/recycle-bin.md and
// docs/shares-compliance.md.

const adapter = require('../../complianceAdvisory/instances').getAdapter('shares');

module.exports = adapter;
