'use strict';

// Finance-flavoured view of the shared Compliance Advisory report/Markdown builder. See docs/finance-compliance.md.

const r = require('../complianceAdvisory/instances').parts('finance').reports;

module.exports = {
  DISCLAIMER: r.DISCLAIMER,
  buildReport: r.buildReport,
  markdownFor: r.markdownFor,
  publicSource: r.publicSource,
  clip: r.clip,
};
