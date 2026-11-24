'use strict';

// Finance spend cap, backed by the shared Cost guard. See docs/finance-compliance.md.

const s = require('../complianceAdvisory/instances').parts('finance').spend;

module.exports = {
  FEATURE: s.FEATURE,
  monthlyCapUsd: s.monthlyCapUsd,
  estimateUsd: s.estimateUsd,
  monthStart: s.monthStart,
  spendStatus: s.spendStatus,
  assertWithinCap: s.assertWithinCap,
};
