'use strict';

const {
  EVENT_TYPES,
  RATE_TYPES,
  DEPENDENCY_KINDS,
  ASSUMPTION_SEVERITIES,
  AU_STATES,
} = require('./constants');

/**
 * @typedef {object} LoanSnapshot
 * @property {number} balance
 * @property {number} rate — annual interest rate as percent (e.g. 5.89)
 * @property {'fixed'|'variable'} fixed_or_variable
 * @property {number} term_remaining_months — months left on the *loan* (amortisation), not the fixed period
 * @property {number} [fixed_period_remaining_months] — months left on the *fixed-rate* period only (AU typically 12–60). Required for IRD break-cost estimates when fixed.
 * @property {string} [lender]
 * @property {string} [property_id] — property this loan is secured against
 */

/**
 * @typedef {object} StartingProperty
 * @property {string} id
 * @property {string} [label]
 * @property {string} state — AU state/territory
 * @property {number} [estimated_value]
 * @property {LoanSnapshot} [current_loan]
 * @property {boolean} [was_ever_investment_property]
 * @property {number} [purchase_price]
 * @property {string} [purchase_date] — ISO date
 */

/**
 * @typedef {object} SellFields
 * @property {string} property_id
 * @property {number} property_value — expected sale price
 * @property {number} purchase_price — original purchase (CGT basis)
 * @property {string} purchase_date — ISO date
 * @property {boolean} was_ever_investment_property
 * @property {string} state
 * @property {string} [settlement_date]
 */

/**
 * @typedef {object} BuyFields
 * @property {string} property_id — id assigned to the newly acquired property
 * @property {number} property_value — purchase price
 * @property {string} state
 * @property {boolean} is_first_home_buyer
 * @property {string} [deposit_source] — free-text or event-ref note; formal links live in dependencies
 * @property {number} [deposit_amount]
 * @property {LoanSnapshot} [loan]
 * @property {string} [settlement_date]
 */

/**
 * @typedef {object} RefinanceFields
 * @property {string} property_id
 * @property {LoanSnapshot} current_loan
 * @property {LoanSnapshot} target_loan
 */

/**
 * @typedef {object} SwitchLenderFields
 * @property {string} property_id
 * @property {LoanSnapshot} current_loan
 * @property {LoanSnapshot} target_loan
 */

/**
 * @typedef {object} EarlyPayoutFields
 * @property {string} property_id
 * @property {LoanSnapshot} current_loan
 * @property {string} payout_date — ISO date
 * @property {number} [fixed_period_remaining_months] — override if not on current_loan
 */

/**
 * @typedef {object} ScenarioEvent
 * @property {string} id
 * @property {import('./constants').EventType|string} type
 * @property {number} sequence — explicit order (1-based preferred; unique)
 * @property {string} [label]
 * @property {SellFields|BuyFields|RefinanceFields|SwitchLenderFields|EarlyPayoutFields} fields
 */

/**
 * @typedef {object} EventDependency
 * @property {string} id
 * @property {string} from_event_id
 * @property {string} to_event_id
 * @property {import('./constants').DependencyKind|string} kind
 * @property {string} [note]
 */

/**
 * @typedef {object} TimelineGap
 * @property {string} after_event_id
 * @property {string} before_event_id
 * @property {number} [assumed_days]
 * @property {string} [note]
 */

/**
 * @typedef {object} TimelineOverlap
 * @property {string} event_a_id
 * @property {string} event_b_id
 * @property {string} [note]
 */

/**
 * @typedef {object} ScenarioTimeline
 * @property {TimelineGap[]} [gaps]
 * @property {TimelineOverlap[]} [overlaps]
 */

/**
 * @typedef {object} UnresolvedAssumption
 * @property {string} id
 * @property {string} field_path — e.g. "events[0].fields.settlement_date"
 * @property {string} message
 * @property {import('./constants').AssumptionSeverity|string} [severity]
 */

/**
 * @typedef {object} Scenario
 * @property {string} id
 * @property {string} [title]
 * @property {string} [currency]
 * @property {StartingProperty[]} starting_properties
 * @property {ScenarioEvent[]} events — ordered by sequence when validated
 * @property {EventDependency[]} dependencies
 * @property {ScenarioTimeline} timeline
 * @property {UnresolvedAssumption[]} unresolved_assumptions
 */

/**
 * Build a loan snapshot with defaults left undefined (assumptions collected later).
 * @param {Partial<LoanSnapshot>} raw
 * @returns {LoanSnapshot}
 */
function createLoanSnapshot(raw = {}) {
  return {
    balance: raw.balance,
    rate: raw.rate,
    fixed_or_variable: raw.fixed_or_variable,
    term_remaining_months: raw.term_remaining_months,
    ...(raw.fixed_period_remaining_months != null
      ? { fixed_period_remaining_months: raw.fixed_period_remaining_months }
      : {}),
    ...(raw.lender != null ? { lender: raw.lender } : {}),
    ...(raw.property_id != null ? { property_id: raw.property_id } : {}),
  };
}

/**
 * Create a Scenario document. Does not validate — call validateScenario().
 * @param {Partial<Scenario>} raw
 * @returns {Scenario}
 */
function createScenario(raw = {}) {
  return {
    id: raw.id || `scenario_${Date.now()}`,
    title: raw.title || '',
    currency: raw.currency || 'AUD',
    starting_properties: Array.isArray(raw.starting_properties)
      ? raw.starting_properties.map((p) => ({ ...p }))
      : [],
    events: Array.isArray(raw.events)
      ? raw.events.map((e) => ({
          id: e.id,
          type: e.type,
          sequence: e.sequence,
          ...(e.label != null ? { label: e.label } : {}),
          fields: e.fields ? { ...e.fields } : {},
        }))
      : [],
    dependencies: Array.isArray(raw.dependencies)
      ? raw.dependencies.map((d) => ({ ...d }))
      : [],
    timeline: {
      gaps: Array.isArray(raw.timeline?.gaps) ? raw.timeline.gaps.map((g) => ({ ...g })) : [],
      overlaps: Array.isArray(raw.timeline?.overlaps)
        ? raw.timeline.overlaps.map((o) => ({ ...o }))
        : [],
    },
    unresolved_assumptions: Array.isArray(raw.unresolved_assumptions)
      ? raw.unresolved_assumptions.map((a) => ({ ...a }))
      : [],
  };
}

/**
 * Events sorted by sequence (does not mutate).
 * @param {Scenario} scenario
 * @returns {ScenarioEvent[]}
 */
function orderedEvents(scenario) {
  return [...(scenario.events || [])].sort((a, b) => a.sequence - b.sequence);
}

module.exports = {
  createLoanSnapshot,
  createScenario,
  orderedEvents,
  EVENT_TYPES,
  RATE_TYPES,
  DEPENDENCY_KINDS,
  ASSUMPTION_SEVERITIES,
  AU_STATES,
};
