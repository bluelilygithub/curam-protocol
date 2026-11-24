'use strict';

// Shares PDF: the shared renderer with the Shares title. See docs/shares-compliance.md.

const pdf = require('../complianceAdvisory/instances').parts('shares').pdf;

module.exports = {
  buildSharesCompliancePdfBuffer: pdf.buildCompliancePdfBuffer,
  clean: pdf.clean,
  stripInline: pdf.stripInline,
};
