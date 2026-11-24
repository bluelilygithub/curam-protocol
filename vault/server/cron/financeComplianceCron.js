'use strict';

// Finance Compliance Advisory: 7 AM on the 2nd of each month in the workspace timezone. Runs inline under a
// separate Postgres advisory lock from Shares. See docs/finance-compliance.md.

const c = require('../services/complianceAdvisory/instances').getCron('finance');

const startFinanceComplianceCron = c.startCron;

module.exports = {
  startFinanceComplianceCron,
  runMonthlyCompliance: c.runMonthlyCompliance,
  getWorkspaceTimezone: c.getWorkspaceTimezone,
  getAdminIds: c.getAdminIds,
  SCHEDULE: c.SCHEDULE,
};
