'use strict';

const {
  EVENT_TYPES,
  RATE_TYPES,
  DEPENDENCY_KINDS,
  ASSUMPTION_SEVERITIES,
  AU_STATES,
} = require('./constants');
const { orderedEvents } = require('./scenario');

/**
 * @typedef {object} ValidationIssue
 * @property {'error'|'warning'} severity
 * @property {string} code
 * @property {string} message
 * @property {string} [path]
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} ok
 * @property {ValidationIssue[]} errors
 * @property {ValidationIssue[]} warnings
 */

function issue(severity, code, message, path) {
  return { severity, code, message, ...(path ? { path } : {}) };
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function isNonEmptyString(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

function isIsoDate(s) {
  if (!isNonEmptyString(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

/**
 * Validate a loan snapshot shape.
 * @param {object|null|undefined} loan
 * @param {string} path
 * @param {ValidationIssue[]} errors
 * @param {{ requirePropertyId?: boolean, draft?: boolean }} [opts]
 * @param {ValidationIssue[]} [warnings]
 */
function validateLoan(loan, path, errors, opts = {}, warnings = []) {
  const soft = opts.draft ? warnings : errors;
  const sev = opts.draft ? 'warning' : 'error';
  if (!loan || typeof loan !== 'object') {
    soft.push(issue(sev, 'loan_missing', 'Loan snapshot is required', path));
    return;
  }
  if (!isFiniteNumber(loan.balance) || loan.balance < 0) {
    soft.push(issue(sev, 'loan_balance', 'Loan balance must be a non-negative number', `${path}.balance`));
  }
  if (!isFiniteNumber(loan.rate) || loan.rate < 0) {
    soft.push(issue(sev, 'loan_rate', 'Loan rate must be a non-negative number', `${path}.rate`));
  }
  if (!RATE_TYPES.includes(loan.fixed_or_variable)) {
    soft.push(issue(
      sev,
      'loan_rate_type',
      `fixed_or_variable must be one of: ${RATE_TYPES.join(', ')}`,
      `${path}.fixed_or_variable`
    ));
  }
  if (!isFiniteNumber(loan.term_remaining_months) || loan.term_remaining_months < 0) {
    soft.push(issue(
      sev,
      'loan_term',
      'term_remaining_months must be a non-negative number',
      `${path}.term_remaining_months`
    ));
  }
  if (opts.requirePropertyId && !isNonEmptyString(loan.property_id)) {
    soft.push(issue(sev, 'loan_property', 'property_id is required on loan', `${path}.property_id`));
  }
}

/**
 * Walk events in order and track which properties are currently owned.
 * @param {import('./scenario').Scenario} scenario
 * @returns {{ owned: Map<string, object>, introducedBy: Map<string, string> }}
 */
function buildPropertyLedger(scenario) {
  /** @type {Map<string, object>} */
  const owned = new Map();
  /** @type {Map<string, string>} */
  const introducedBy = new Map();

  for (const p of scenario.starting_properties || []) {
    if (p?.id) {
      owned.set(p.id, { ...p, source: 'starting' });
      introducedBy.set(p.id, 'starting');
    }
  }

  return { owned, introducedBy };
}

/**
 * Validate sell event fields against the live property ledger.
 * @param {object} fields
 * @param {string} path
 * @param {Map<string, object>} owned
 * @param {ValidationIssue[]} errors
 * @param {{ draft?: boolean }} [opts]
 * @param {ValidationIssue[]} [warnings]
 */
function validateSell(fields, path, owned, errors, opts = {}, warnings = []) {
  const soft = opts.draft ? warnings : errors;
  const sev = opts.draft ? 'warning' : 'error';
  if (!isNonEmptyString(fields.property_id)) {
    errors.push(issue('error', 'sell_property_id', 'sell requires property_id', `${path}.property_id`));
  } else if (!owned.has(fields.property_id)) {
    errors.push(issue(
      'error',
      'sell_unknown_property',
      `Cannot sell property "${fields.property_id}" — it does not exist in earlier events or starting_properties`,
      `${path}.property_id`
    ));
  }
  if (!isFiniteNumber(fields.property_value) || fields.property_value <= 0) {
    soft.push(issue(sev, 'sell_value', 'property_value must be a positive number', `${path}.property_value`));
  }
  if (!isFiniteNumber(fields.purchase_price) || fields.purchase_price < 0) {
    soft.push(issue(sev, 'sell_purchase_price', 'purchase_price must be a non-negative number', `${path}.purchase_price`));
  }
  if (!isIsoDate(fields.purchase_date)) {
    soft.push(issue(sev, 'sell_purchase_date', 'purchase_date must be an ISO date string', `${path}.purchase_date`));
  }
  if (typeof fields.was_ever_investment_property !== 'boolean') {
    soft.push(issue(
      sev,
      'sell_investment_flag',
      'was_ever_investment_property must be a boolean',
      `${path}.was_ever_investment_property`
    ));
  }
  if (!isNonEmptyString(fields.state) || !AU_STATES.includes(fields.state)) {
    soft.push(issue(sev, 'sell_state', `state must be one of: ${AU_STATES.join(', ')}`, `${path}.state`));
  }
}

/**
 * @param {object} fields
 * @param {string} path
 * @param {Map<string, object>} owned
 * @param {ValidationIssue[]} errors
 * @param {{ draft?: boolean }} [opts]
 * @param {ValidationIssue[]} [warnings]
 */
function validateBuy(fields, path, owned, errors, opts = {}, warnings = []) {
  const soft = opts.draft ? warnings : errors;
  const sev = opts.draft ? 'warning' : 'error';
  if (!isNonEmptyString(fields.property_id)) {
    errors.push(issue('error', 'buy_property_id', 'buy requires property_id for the new property', `${path}.property_id`));
  } else if (owned.has(fields.property_id)) {
    errors.push(issue(
      'error',
      'buy_duplicate_property',
      `property_id "${fields.property_id}" already exists — buy must introduce a new id`,
      `${path}.property_id`
    ));
  }
  if (!isFiniteNumber(fields.property_value) || fields.property_value <= 0) {
    soft.push(issue(sev, 'buy_value', 'property_value must be a positive number', `${path}.property_value`));
  }
  if (!isNonEmptyString(fields.state) || !AU_STATES.includes(fields.state)) {
    soft.push(issue(sev, 'buy_state', `state must be one of: ${AU_STATES.join(', ')}`, `${path}.state`));
  }
  if (typeof fields.is_first_home_buyer !== 'boolean') {
    soft.push(issue(sev, 'buy_fhb', 'is_first_home_buyer must be a boolean', `${path}.is_first_home_buyer`));
  }
  if (fields.loan) {
    validateLoan(fields.loan, `${path}.loan`, errors, opts, warnings);
  }
}

/**
 * @param {object} fields
 * @param {string} path
 * @param {Map<string, object>} owned
 * @param {ValidationIssue[]} errors
 * @param {string} eventType
 * @param {{ draft?: boolean }} [opts]
 * @param {ValidationIssue[]} [warnings]
 */
function validateRefinanceLike(fields, path, owned, errors, eventType, opts = {}, warnings = []) {
  if (!isNonEmptyString(fields.property_id)) {
    errors.push(issue('error', `${eventType}_property_id`, `${eventType} requires property_id`, `${path}.property_id`));
  } else if (!owned.has(fields.property_id)) {
    errors.push(issue(
      'error',
      `${eventType}_unknown_property`,
      `Cannot ${eventType.replace('_', ' ')} property "${fields.property_id}" — not currently owned`,
      `${path}.property_id`
    ));
  }
  validateLoan(fields.current_loan, `${path}.current_loan`, errors, opts, warnings);
  validateLoan(fields.target_loan, `${path}.target_loan`, errors, opts, warnings);
}

/**
 * @param {object} fields
 * @param {string} path
 * @param {Map<string, object>} owned
 * @param {ValidationIssue[]} errors
 * @param {{ draft?: boolean }} [opts]
 * @param {ValidationIssue[]} [warnings]
 */
function validateEarlyPayout(fields, path, owned, errors, opts = {}, warnings = []) {
  const soft = opts.draft ? warnings : errors;
  const sev = opts.draft ? 'warning' : 'error';
  if (!isNonEmptyString(fields.property_id)) {
    errors.push(issue('error', 'payout_property_id', 'early_payout requires property_id', `${path}.property_id`));
  } else if (!owned.has(fields.property_id)) {
    errors.push(issue(
      'error',
      'payout_unknown_property',
      `Cannot payout loan on "${fields.property_id}" — not currently owned`,
      `${path}.property_id`
    ));
  }
  validateLoan(fields.current_loan, `${path}.current_loan`, errors, opts, warnings);
  if (!isIsoDate(fields.payout_date)) {
    soft.push(issue(sev, 'payout_date', 'payout_date must be an ISO date string', `${path}.payout_date`));
  }
}

/**
 * Apply event to the property ledger (mutates owned).
 * Only applies ownership changes when the operation is structurally valid.
 * @param {import('./scenario').ScenarioEvent} event
 * @param {Map<string, object>} owned
 */
function applyEventToLedger(event, owned) {
  const f = event.fields || {};
  if (event.type === 'buy' && f.property_id && !owned.has(f.property_id)) {
    owned.set(f.property_id, {
      id: f.property_id,
      state: f.state,
      estimated_value: f.property_value,
      current_loan: f.loan || null,
      source: event.id,
    });
  }
  if (event.type === 'sell' && f.property_id && owned.has(f.property_id)) {
    owned.delete(f.property_id);
  }
  if ((event.type === 'refinance' || event.type === 'switch_lender') && f.property_id && owned.has(f.property_id)) {
    const prev = owned.get(f.property_id);
    owned.set(f.property_id, { ...prev, current_loan: f.target_loan });
  }
  if (event.type === 'early_payout' && f.property_id && owned.has(f.property_id)) {
    const prev = owned.get(f.property_id);
    owned.set(f.property_id, { ...prev, current_loan: null });
  }
}

/**
 * Validate a Scenario. Checks structure, event fields, property existence across
 * the timeline, and explicit dependencies. Does not run financial calculations.
 *
 * @param {import('./scenario').Scenario} scenario
 * @param {{ draft?: boolean }} [opts] — draft=true: missing calc fields are warnings (NLP parse stage)
 * @returns {ValidationResult}
 */
function validateScenario(scenario, opts = {}) {
  const draft = Boolean(opts.draft);
  /** @type {ValidationIssue[]} */
  const errors = [];
  /** @type {ValidationIssue[]} */
  const warnings = [];

  if (!scenario || typeof scenario !== 'object') {
    return {
      ok: false,
      errors: [issue('error', 'scenario_missing', 'Scenario is required')],
      warnings: [],
    };
  }

  if (!isNonEmptyString(scenario.id)) {
    errors.push(issue('error', 'scenario_id', 'Scenario id is required', 'id'));
  }

  // Starting properties
  const seenStartIds = new Set();
  (scenario.starting_properties || []).forEach((p, i) => {
    const path = `starting_properties[${i}]`;
    if (!isNonEmptyString(p.id)) {
      errors.push(issue('error', 'start_property_id', 'Starting property requires id', `${path}.id`));
      return;
    }
    if (seenStartIds.has(p.id)) {
      errors.push(issue('error', 'start_property_dup', `Duplicate starting property id "${p.id}"`, `${path}.id`));
    }
    seenStartIds.add(p.id);
    if (p.state && !AU_STATES.includes(p.state)) {
      errors.push(issue('error', 'start_state', `state must be one of: ${AU_STATES.join(', ')}`, `${path}.state`));
    }
    if (p.current_loan) {
      validateLoan(p.current_loan, `${path}.current_loan`, errors, { draft }, warnings);
    }
  });

  const events = scenario.events || [];
  if (!events.length) {
    warnings.push(issue('warning', 'no_events', 'Scenario has no events'));
  }

  const eventIds = new Set();
  const sequences = new Set();

  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    const path = `events[${i}]`;
    if (!isNonEmptyString(e.id)) {
      errors.push(issue('error', 'event_id', 'Event id is required', `${path}.id`));
    } else if (eventIds.has(e.id)) {
      errors.push(issue('error', 'event_id_dup', `Duplicate event id "${e.id}"`, `${path}.id`));
    } else {
      eventIds.add(e.id);
    }

    if (!isFiniteNumber(e.sequence)) {
      errors.push(issue('error', 'event_sequence', 'Event sequence must be a number', `${path}.sequence`));
    } else if (sequences.has(e.sequence)) {
      errors.push(issue('error', 'event_sequence_dup', `Duplicate sequence ${e.sequence}`, `${path}.sequence`));
    } else {
      sequences.add(e.sequence);
    }

    if (!EVENT_TYPES.includes(e.type)) {
      errors.push(issue(
        'error',
        'event_type',
        `Unknown event type "${e.type}". Expected: ${EVENT_TYPES.join(', ')}`,
        `${path}.type`
      ));
    }

    if (!e.fields || typeof e.fields !== 'object') {
      errors.push(issue('error', 'event_fields', 'Event fields object is required', `${path}.fields`));
    }
  }

  // Walk in timeline order — property existence depends on earlier events
  const { owned } = buildPropertyLedger(scenario);
  const sorted = orderedEvents(scenario);
  const draftOpts = { draft };

  for (const event of sorted) {
    if (!EVENT_TYPES.includes(event.type) || !event.fields) continue;
    const idx = events.indexOf(event);
    const path = `events[${idx}].fields`;

    switch (event.type) {
      case 'sell':
        validateSell(event.fields, path, owned, errors, draftOpts, warnings);
        break;
      case 'buy':
        validateBuy(event.fields, path, owned, errors, draftOpts, warnings);
        break;
      case 'refinance':
        validateRefinanceLike(event.fields, path, owned, errors, 'refinance', draftOpts, warnings);
        break;
      case 'switch_lender':
        validateRefinanceLike(event.fields, path, owned, errors, 'switch_lender', draftOpts, warnings);
        break;
      case 'early_payout':
        validateEarlyPayout(event.fields, path, owned, errors, draftOpts, warnings);
        break;
      default:
        break;
    }

    applyEventToLedger(event, owned);
  }

  // Dependencies — explicit links only (never inferred)
  const deps = scenario.dependencies || [];
  const eventById = new Map(events.map((e) => [e.id, e]));
  const sequenceById = new Map(events.map((e) => [e.id, e.sequence]));

  deps.forEach((d, i) => {
    const path = `dependencies[${i}]`;
    if (!isNonEmptyString(d.id)) {
      errors.push(issue('error', 'dep_id', 'Dependency id is required', `${path}.id`));
    }
    if (!isNonEmptyString(d.from_event_id) || !eventById.has(d.from_event_id)) {
      errors.push(issue('error', 'dep_from', `from_event_id "${d.from_event_id}" not found`, `${path}.from_event_id`));
    }
    if (!isNonEmptyString(d.to_event_id) || !eventById.has(d.to_event_id)) {
      errors.push(issue('error', 'dep_to', `to_event_id "${d.to_event_id}" not found`, `${path}.to_event_id`));
    }
    if (!DEPENDENCY_KINDS.includes(d.kind)) {
      errors.push(issue(
        'error',
        'dep_kind',
        `kind must be one of: ${DEPENDENCY_KINDS.join(', ')}`,
        `${path}.kind`
      ));
    }
    if (
      eventById.has(d.from_event_id)
      && eventById.has(d.to_event_id)
      && sequenceById.get(d.from_event_id) >= sequenceById.get(d.to_event_id)
    ) {
      errors.push(issue(
        'error',
        'dep_order',
        `Dependency must run forward in time: ${d.from_event_id} (seq ${sequenceById.get(d.from_event_id)}) → ${d.to_event_id} (seq ${sequenceById.get(d.to_event_id)})`,
        path
      ));
    }

    // Soft check: funds_deposit usually links sell → buy
    if (
      d.kind === 'funds_deposit'
      && eventById.has(d.from_event_id)
      && eventById.has(d.to_event_id)
    ) {
      const from = eventById.get(d.from_event_id);
      const to = eventById.get(d.to_event_id);
      if (from.type !== 'sell' || to.type !== 'buy') {
        warnings.push(issue(
          'warning',
          'dep_funds_shape',
          'funds_deposit typically links a sell event to a buy event',
          path
        ));
      }
    }
  });

  // Timeline gaps / overlaps reference valid events
  (scenario.timeline?.gaps || []).forEach((g, i) => {
    const path = `timeline.gaps[${i}]`;
    if (!eventById.has(g.after_event_id) || !eventById.has(g.before_event_id)) {
      errors.push(issue('error', 'gap_events', 'Gap must reference existing event ids', path));
    } else if (sequenceById.get(g.after_event_id) >= sequenceById.get(g.before_event_id)) {
      errors.push(issue('error', 'gap_order', 'Gap after_event must precede before_event', path));
    }
  });

  (scenario.timeline?.overlaps || []).forEach((o, i) => {
    const path = `timeline.overlaps[${i}]`;
    if (!eventById.has(o.event_a_id) || !eventById.has(o.event_b_id)) {
      errors.push(issue('error', 'overlap_events', 'Overlap must reference existing event ids', path));
    }
  });

  // Unresolved assumptions — shape only
  (scenario.unresolved_assumptions || []).forEach((a, i) => {
    const path = `unresolved_assumptions[${i}]`;
    if (!isNonEmptyString(a.id)) {
      errors.push(issue('error', 'assumption_id', 'Assumption id is required', `${path}.id`));
    }
    if (!isNonEmptyString(a.field_path)) {
      errors.push(issue('error', 'assumption_path', 'field_path is required', `${path}.field_path`));
    }
    if (!isNonEmptyString(a.message)) {
      errors.push(issue('error', 'assumption_message', 'message is required', `${path}.message`));
    }
    if (a.severity != null && !ASSUMPTION_SEVERITIES.includes(a.severity)) {
      errors.push(issue(
        'error',
        'assumption_severity',
        `severity must be one of: ${ASSUMPTION_SEVERITIES.join(', ')}`,
        `${path}.severity`
      ));
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate and throw if invalid (errors only — warnings allowed).
 * @param {import('./scenario').Scenario} scenario
 * @returns {import('./scenario').Scenario}
 */
function assertValidScenario(scenario) {
  const result = validateScenario(scenario);
  if (!result.ok) {
    const detail = result.errors.map((e) => `${e.path || '?'}: ${e.message}`).join('; ');
    const err = new Error(`Invalid scenario: ${detail}`);
    err.validation = result;
    throw err;
  }
  return scenario;
}

module.exports = {
  validateScenario,
  assertValidScenario,
};
