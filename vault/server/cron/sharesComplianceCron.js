'use strict';

// Shares Compliance Advisory: 7 AM on the 2nd of each month in the workspace timezone. Runs inline under a
// Postgres advisory lock so two servers in a rolling deploy cannot create two reports. See docs/shares-compliance.md.

const c = require('../services/complianceAdvisory/instances').getCron('shares');

const startSharesComplianceCron = c.startCron;

module.exports = {
  startSharesComplianceCron,
  runMonthlyCompliance: c.runMonthlyCompliance,
  getWorkspaceTimezone: c.getWorkspaceTimezone,
  getAdminIds: c.getAdminIds,
  SCHEDULE: c.SCHEDULE,
};
