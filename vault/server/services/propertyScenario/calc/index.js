'use strict';

const { calculateStampDutyLmi } = require('./stampDutyLmi');
const { calculateCgt } = require('./cgt');
const { calculateRefinanceBreakEven } = require('./refinanceBreakEven');
const { calculateEarlyPayoutBreakCost } = require('./earlyPayout');
const { calculateRepayment } = require('./repayment');
const { calculateExtraRepayments } = require('./extraRepayments');
const { calculateOffsetBenefit } = require('./offset');
const { calculateBorrowingPower } = require('./borrowingPower');
const {
  calculateBridgingCost,
  resolveBridgingGapFromScenario,
} = require('./bridgingCost');
const { AS_OF, STAMP_DUTY_TABLES, dutyFromBrackets } = require('./tables');
const loanMath = require('./loanMath');

module.exports = {
  AS_OF,
  STAMP_DUTY_TABLES,
  dutyFromBrackets,
  // Stage 3 — scenario event modules
  calculateStampDutyLmi,
  calculateCgt,
  calculateRefinanceBreakEven,
  calculateEarlyPayoutBreakCost,
  calculateBridgingCost,
  resolveBridgingGapFromScenario,
  // Stage 5 — standalone reusable calculators
  calculateRepayment,
  calculateExtraRepayments,
  calculateOffsetBenefit,
  calculateBorrowingPower,
  loanMath,
};
