'use strict';

// Shares-flavoured view of the shared Compliance Advisory report/Markdown builder. See docs/shares-compliance.md.

const r = require('../complianceAdvisory/instances').parts('shares').reports;

module.exports = {
  DISCLAIMER: r.DISCLAIMER,
  buildReport: r.buildReport,
  markdownFor: r.markdownFor,
  publicSource: r.publicSource,
  clip: r.clip,
};
