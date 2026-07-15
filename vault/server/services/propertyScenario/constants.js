'use strict';

/** @typedef {'sell' | 'buy' | 'refinance' | 'switch_lender' | 'early_payout'} EventType */
/** @typedef {'fixed' | 'variable'} RateType */
/** @typedef {'funds_deposit' | 'clears_loan' | 'releases_security' | 'other'} DependencyKind */
/** @typedef {'required' | 'optional'} AssumptionSeverity */

const EVENT_TYPES = Object.freeze([
  'sell',
  'buy',
  'refinance',
  'switch_lender',
  'early_payout',
]);

const RATE_TYPES = Object.freeze(['fixed', 'variable']);

const DEPENDENCY_KINDS = Object.freeze([
  'funds_deposit',
  'clears_loan',
  'releases_security',
  'other',
]);

const ASSUMPTION_SEVERITIES = Object.freeze(['required', 'optional']);

/** Australian states / territories — used for stamp duty orientation later. */
const AU_STATES = Object.freeze([
  'NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT',
]);

module.exports = {
  EVENT_TYPES,
  RATE_TYPES,
  DEPENDENCY_KINDS,
  ASSUMPTION_SEVERITIES,
  AU_STATES,
};
