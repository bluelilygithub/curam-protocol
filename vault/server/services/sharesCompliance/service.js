'use strict';

// Shares Compliance Advisory storage/orchestration. The implementation is shared with Finance; only the
// tables, usage feature, env vars, recycle type and cron lock name come from config. See docs/shares-compliance.md.

const s = require('../complianceAdvisory/instances').parts('shares').service;

module.exports = {
  startReports: s.startReports,
  listReports: s.listReports,
  getReport: s.getReport,
  deleteReport: s.deleteReport,
  rowToPublic: s.rowToPublic,
  REPORT_COLUMNS: s.REPORT_COLUMNS,
  FEATURE: s.FEATURE,
};
