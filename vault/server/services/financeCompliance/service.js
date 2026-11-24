'use strict';

// Finance Compliance Advisory storage/orchestration. The implementation is shared with Shares; only the
// tables, usage feature, env vars, recycle type and cron lock name come from config. See docs/finance-compliance.md.

const s = require('../complianceAdvisory/instances').parts('finance').service;

module.exports = {
  startReports: s.startReports,
  listReports: s.listReports,
  getReport: s.getReport,
  deleteReport: s.deleteReport,
  rowToPublic: s.rowToPublic,
  REPORT_COLUMNS: s.REPORT_COLUMNS,
  FEATURE: s.FEATURE,
};
