'use strict';

// Finance PDF: the shared renderer with the Finance title. See docs/finance-compliance.md.

const pdf = require('../complianceAdvisory/instances').parts('finance').pdf;

module.exports = {
  buildFinanceCompliancePdfBuffer: pdf.buildCompliancePdfBuffer,
  clean: pdf.clean,
  stripInline: pdf.stripInline,
};
