'use strict';

// Shares spend cap, backed by the shared Cost guard. See docs/shares-compliance.md.

const s = require('../complianceAdvisory/instances').parts('shares').spend;

module.exports = {
  FEATURE: s.FEATURE,
  monthlyCapUsd: s.monthlyCapUsd,
  estimateUsd: s.estimateUsd,
  monthStart: s.monthStart,
  spendStatus: s.spendStatus,
  assertWithinCap: s.assertWithinCap,
};
