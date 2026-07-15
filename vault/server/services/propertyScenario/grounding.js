'use strict';

const { AU_STATES } = require('./constants');
const {
  extractSpans,
  spanMatchesCurrency,
  spanMatchesPercent,
  spanMatchesDurationMonths,
  spanMatchesDays,
  spanMatchesDate,
  approxEqual,
} = require('./extractSpans');

/** Full names / aliases that ground an AU state code in free text. */
const STATE_ALIASES = {
  NSW: ['nsw', 'new south wales', 'sydney', 'newcastle', 'wollongong', 'marrickville', 'randwick', 'parramatta'],
  VIC: ['vic', 'victoria', 'melbourne', 'geelong', 'ballarat'],
  QLD: ['qld', 'queensland', 'brisbane', 'gold coast', 'cairns', 'townsville'],
  SA: ['sa', 'south australia', 'adelaide'],
  WA: ['wa', 'western australia', 'perth', 'fremantle'],
  TAS: ['tas', 'tasmania', 'hobart', 'launceston'],
  ACT: ['act', 'australian capital territory', 'canberra'],
  NT: ['nt', 'northern territory', 'darwin', 'alice springs'],
};

const PPOR_INVESTMENT_PATTERNS = [
  /\binvestment\b/i,
  /\brental\s+(propert|income|unit)/i,
  /\brented\s+(out|it)\b/i,
  /\bip\b/i,
  /\bppor\b/i,
  /\bprimary\s+(place\s+of\s+)?residence\b/i,
  /\bprincipal\s+place\s+of\s+residence\b/i,
  /\bmain\s+residence\b/i,
  /\bowner[\s-]?occup/i,
  /\bnever\s+(an?\s+)?investment\b/i,
  /\balways\s+(been\s+)?(our|my|the)\s+(home|ppor|primary)/i,
  /\bnot\s+(an?\s+)?investment\b/i,
  /\bpersonal\s+use\b/i,
];

const FHB_PATTERNS = [
  /\bfirst[\s-]?home\s*buyer\b/i,
  /\bfhb\b/i,
  /\bfirst[\s-]?home\b/i,
  /\bnever\s+(bought|owned)\s+(a\s+)?(property|home|house)\b/i,
  /\bnot\s+a\s+first[\s-]?home\b/i,
];

/** Source text mentions remaining *fixed-rate period* duration (not overall loan amortisation). */
const FIXED_PERIOD_REMAINING_PATTERNS = [
  /\b\d+(\.\d+)?\s*[-–]?\s*years?\s+fixed\b/i,
  /\bfixed\s+(for|at)\s+\d+(\.\d+)?\s*(years?|months?|yrs?)\b/i,
  /\bfixed[\s-]?(rate\s+)?(for|period|term)\b.{0,40}\d+(\.\d+)?\s*(years?|months?|yrs?)\b/i,
  /\b\d+(\.\d+)?\s*(years?|months?|yrs?)\s+(left|remaining)\s+on\s+(the\s+)?fixed\b/i,
  /\b(years?|months?)\s+(left|remaining)\s+on\s+(the\s+)?fixed[\s-]?(rate\s+)?(period|term)?\b/i,
  /\bfixed[\s-]?(rate\s+)?period.{0,40}(left|remaining|\d+)\b/i,
  /\b\d+(\.\d+)?\s*(years?|months?|yrs?)\s+(of\s+)?(the\s+)?fixed[\s-]?(rate\s+)?(period|term)\b/i,
];

/** Source text mentions overall *loan/mortgage term* remaining (amortisation). */
const LOAN_TERM_REMAINING_PATTERNS = [
  /\b\d+(\.\d+)?\s*(years?|months?|yrs?)\s+(left|remaining)\s+on\s+(the\s+)?(loan|mortgage)\b/i,
  /\b(loan|mortgage)\s+term\b.{0,48}\d+(\.\d+)?\s*(years?|months?|yrs?)?\b/i,
  /\b\d+(\.\d+)?\s*(years?|months?|yrs?)\s+(left|remaining)\s+(on|of)\s+(the\s+)?(loan|mortgage)\s+term\b/i,
  /\bterm\s+(left|remaining)\b.{0,24}\d+/i,
  /\b\d+(\.\d+)?\s*(years?|months?|yrs?)\s+(left|remaining)\s+(to\s+)?(go|pay)\b/i,
  /\b\d+(\.\d+)?\s*year\s+(loan|mortgage)\b/i,
  /\b(loan|mortgage).{0,40}\b\d+(\.\d+)?\s*years?\s+(left|remaining)\b/i,
];

function normalizeText(text) {
  return ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
}

function textGroundsFixedPeriodRemaining(text) {
  return FIXED_PERIOD_REMAINING_PATTERNS.some((re) => re.test(text));
}

function textGroundsLoanTermRemaining(text) {
  return LOAN_TERM_REMAINING_PATTERNS.some((re) => re.test(text));
}

/**
 * Duration span may ground fixed-period only when nearby text mentions "fixed".
 * Prevents a single "3-year"/"15 years" span from falsely grounding both loan term and fixed period.
 */
function spanGroundsFixedPeriodMonths(spans, months, sourceText) {
  const m = Number(months);
  if (!Number.isFinite(m)) return false;
  return (spans || []).some((s) => {
    if (s.kind !== 'duration') return false;
    if (s.value_months == null || !approxEqual(s.value_months, m, 0.5)) return false;
    const window = String(sourceText || '').slice(
      Math.max(0, s.start - 28),
      Math.min(String(sourceText || '').length, s.end + 28)
    );
    return /\bfixed\b/i.test(window);
  });
}

function spanGroundsLoanTermMonths(spans, months, sourceText) {
  const m = Number(months);
  if (!Number.isFinite(m)) return false;
  return (spans || []).some((s) => {
    if (s.kind !== 'duration') return false;
    if (s.value_months == null || !approxEqual(s.value_months, m, 0.5)) return false;
    const window = String(sourceText || '').slice(
      Math.max(0, s.start - 48),
      Math.min(String(sourceText || '').length, s.end + 48)
    );
    return /\b(loan|mortgage|amort|term)\b/i.test(window);
  });
}

function textMentionsState(textNorm, stateCode) {
  const aliases = STATE_ALIASES[stateCode] || [String(stateCode).toLowerCase()];
  return aliases.some((alias) => {
    const token = ` ${alias} `;
    return textNorm.includes(token);
  });
}

function textMentionsAnyState(textNorm) {
  return AU_STATES.some((s) => textMentionsState(textNorm, s));
}

function textGroundsPporOrInvestment(text) {
  return PPOR_INVESTMENT_PATTERNS.some((re) => re.test(text));
}

function textGroundsFhb(text) {
  return FHB_PATTERNS.some((re) => re.test(text));
}

function pushAssumption(scenario, assumption) {
  if (!scenario.unresolved_assumptions) scenario.unresolved_assumptions = [];
  const key = String(assumption.message || '').toLowerCase().slice(0, 120);
  const exists = scenario.unresolved_assumptions.some(
    (a) => String(a.message || '').toLowerCase().slice(0, 120) === key
      || a.field_path === assumption.field_path
  );
  if (exists) return;
  scenario.unresolved_assumptions.push(assumption);
}

/**
 * Strip ungrounded loan term / fixed-period months and block equal-value conflation.
 * Mutates loan + scenario; appends to stripped[].
 *
 * @param {object|null|undefined} loan
 * @param {string} loanPath
 * @param {import('./scenario').Scenario} scenario
 * @param {string} text
 * @param {string[]} stripped
 * @param {object[]} [spans]
 */
function groundLoanAgainstText(loan, loanPath, scenario, text, stripped, spans = []) {
  if (!loan || typeof loan !== 'object') return;

  const term = loan.term_remaining_months;
  const fixed = loan.fixed_period_remaining_months;
  const fixedFromText = textGroundsFixedPeriodRemaining(text);
  const termFromText = textGroundsLoanTermRemaining(text);
  const bothNumeric = Number.isFinite(Number(term)) && Number.isFinite(Number(fixed));
  const equalMonths = bothNumeric && Number(term) === Number(fixed);

  // When both fields share one number, a single duration span must not ground both concepts —
  // rely on text patterns only for the conflation branch.
  const fixedGrounded = equalMonths
    ? fixedFromText
    : (fixedFromText || spanGroundsFixedPeriodMonths(spans, fixed, text));
  const termGrounded = equalMonths
    ? termFromText
    : (termFromText || spanGroundsLoanTermMonths(spans, term, text));

  // Classic conflation: model copies the only duration into both fields.
  if (equalMonths) {
    if (fixedGrounded && !termGrounded) {
      stripped.push(`${loanPath}.term_remaining_months`);
      delete loan.term_remaining_months;
      pushAssumption(scenario, {
        id: `ass_ground_loan_term_${loanPath.replace(/[^a-z0-9]+/gi, '_')}`,
        field_path: `${loanPath}.term_remaining_months`,
        message:
          'How many months/years are left on the overall loan term (amortisation)? '
          + 'That is separate from the fixed-rate period — do not reuse the fixed-period duration.',
        severity: 'required',
      });
    } else if (termGrounded && !fixedGrounded) {
      stripped.push(`${loanPath}.fixed_period_remaining_months`);
      delete loan.fixed_period_remaining_months;
      pushAssumption(scenario, {
        id: `ass_ground_fixed_period_${loanPath.replace(/[^a-z0-9]+/gi, '_')}`,
        field_path: `${loanPath}.fixed_period_remaining_months`,
        message:
          'How many months are left on the fixed-rate period (typically 1–5 years in Australia)? '
          + 'That is separate from overall loan term remaining.',
        severity: 'required',
      });
    } else if (!termGrounded && !fixedGrounded) {
      stripped.push(`${loanPath}.term_remaining_months`);
      stripped.push(`${loanPath}.fixed_period_remaining_months`);
      delete loan.term_remaining_months;
      delete loan.fixed_period_remaining_months;
      pushAssumption(scenario, {
        id: `ass_ground_term_conflation_${loanPath.replace(/[^a-z0-9]+/gi, '_')}`,
        field_path: loanPath,
        message:
          'Clarify separately: (1) months left on the overall loan term, and '
          + '(2) months left on any fixed-rate period — these must not share the same invented value.',
        severity: 'required',
      });
    }
  } else {
    if (loan.term_remaining_months != null && !termGrounded) {
      stripped.push(`${loanPath}.term_remaining_months`);
      delete loan.term_remaining_months;
      pushAssumption(scenario, {
        id: `ass_ground_loan_term_${loanPath.replace(/[^a-z0-9]+/gi, '_')}`,
        field_path: `${loanPath}.term_remaining_months`,
        message:
          'How many months/years are left on the overall loan term (amortisation)?',
        severity: 'required',
      });
    }
    if (loan.fixed_period_remaining_months != null && !fixedGrounded) {
      stripped.push(`${loanPath}.fixed_period_remaining_months`);
      delete loan.fixed_period_remaining_months;
      pushAssumption(scenario, {
        id: `ass_ground_fixed_period_${loanPath.replace(/[^a-z0-9]+/gi, '_')}`,
        field_path: `${loanPath}.fixed_period_remaining_months`,
        message:
          'How many months are left on the fixed-rate period (typically 1–5 years in Australia)? '
          + 'Do not use overall loan term remaining for break-cost estimates.',
        severity: 'required',
      });
    }
  }

  // Fixed loan without a grounded fixed period → always ask (even if model omitted the field).
  if (loan.fixed_or_variable === 'fixed' && loan.fixed_period_remaining_months == null) {
    pushAssumption(scenario, {
      id: `ass_ground_fixed_period_missing_${loanPath.replace(/[^a-z0-9]+/gi, '_')}`,
      field_path: `${loanPath}.fixed_period_remaining_months`,
      message:
        'This loan is fixed — how many months remain on the fixed-rate period '
        + '(not the overall loan term)? Needed for break-cost estimates.',
      severity: 'required',
    });
  }
}

/**
 * Strip inventsed currency / rate / date / day values with no matching pre-extracted span.
 * Complements field-specific state/PPOR/term checks — hard signal of LLM invention.
 *
 * @param {import('./scenario').Scenario} scenario
 * @param {object[]} spans
 * @param {string[]} stripped
 */
function groundInventedNumericsAgainstSpans(scenario, spans, stripped) {
  const stripMoney = (obj, path, key, label) => {
    if (!obj || obj[key] == null) return;
    const n = Number(obj[key]);
    if (!Number.isFinite(n)) return;
    if (spanMatchesCurrency(spans, n)) return;
    stripped.push(`${path}.${key}`);
    delete obj[key];
    pushAssumption(scenario, {
      id: `ass_span_${path}_${key}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 80),
      field_path: `${path}.${key}`,
      message:
        `What is the correct ${label}? (The model filled ${n.toLocaleString()} but that amount `
        + 'was not found as a literal currency span in your text — confirm or correct it.)',
      severity: 'required',
    });
  };

  const stripRate = (loan, path) => {
    if (!loan || loan.rate == null) return;
    const n = Number(loan.rate);
    if (!Number.isFinite(n)) return;
    if (spanMatchesPercent(spans, n)) return;
    stripped.push(`${path}.rate`);
    delete loan.rate;
    pushAssumption(scenario, {
      id: `ass_span_rate_${path}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 80),
      field_path: `${path}.rate`,
      message:
        `What interest rate applies? (Filled ${n}% with no matching percentage span in the source text.)`,
      severity: 'required',
    });
  };

  const stripDate = (obj, path, key, label) => {
    if (!obj || obj[key] == null) return;
    const iso = String(obj[key]).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    if (spanMatchesDate(spans, iso)) return;
    stripped.push(`${path}.${key}`);
    delete obj[key];
    pushAssumption(scenario, {
      id: `ass_span_date_${path}_${key}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 80),
      field_path: `${path}.${key}`,
      message:
        `What is the correct ${label}? (Filled ${iso} with no matching date span in the source text.)`,
      severity: 'required',
    });
  };

  const stripDays = (obj, path, key) => {
    if (!obj || obj[key] == null) return;
    const n = Number(obj[key]);
    if (!Number.isFinite(n)) return;
    if (spanMatchesDays(spans, n) || spanMatchesDurationMonths(spans, n)) return;
    stripped.push(`${path}.${key}`);
    delete obj[key];
    pushAssumption(scenario, {
      id: `ass_span_days_${path}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 80),
      field_path: `${path}.${key}`,
      message:
        `Confirm the timing gap in days (filled ${n} with no matching duration span in the source text).`,
      severity: 'required',
    });
  };

  (scenario.starting_properties || []).forEach((p, i) => {
    const path = `starting_properties[${i}]`;
    stripMoney(p, path, 'estimated_value', 'estimated property value');
    stripMoney(p, path, 'purchase_price', 'original purchase price');
    stripDate(p, path, 'purchase_date', 'original purchase date');
    if (p.current_loan) {
      stripMoney(p.current_loan, `${path}.current_loan`, 'balance', 'loan balance');
      stripRate(p.current_loan, `${path}.current_loan`);
    }
  });

  (scenario.events || []).forEach((e, i) => {
    const fields = e.fields || {};
    const path = `events[${i}].fields`;
    stripMoney(fields, path, 'property_value', 'property value / price');
    stripMoney(fields, path, 'purchase_price', 'purchase price');
    stripMoney(fields, path, 'deposit_amount', 'deposit amount');
    stripMoney(fields, path, 'selling_costs', 'selling costs');
    stripDate(fields, path, 'settlement_date', 'settlement date');
    stripDate(fields, path, 'purchase_date', 'purchase date');
    stripDate(fields, path, 'payout_date', 'payout date');
    ['loan', 'current_loan', 'target_loan'].forEach((k) => {
      if (!fields[k]) return;
      stripMoney(fields[k], `${path}.${k}`, 'balance', 'loan balance');
      stripRate(fields[k], `${path}.${k}`);
    });
  });

  (scenario.timeline?.gaps || []).forEach((g, i) => {
    stripDays(g, `timeline.gaps[${i}]`, 'assumed_days');
  });
}

/**
 * Strip fields that the model filled without textual evidence, and force clarifying questions.
 * Mutates scenario. Returns list of field paths stripped.
 *
 * @param {import('./scenario').Scenario} scenario
 * @param {string} sourceText
 * @param {{ spans?: object[], asOf?: string|Date }} [opts]
 * @returns {{ stripped: string[], grounded_states: string[], spans: object[] }}
 */
function groundScenarioAgainstText(scenario, sourceText, opts = {}) {
  const text = String(sourceText || '');
  const textNorm = normalizeText(text);
  const stripped = [];
  const spanPack = opts.spans
    ? { spans: opts.spans, as_of: opts.asOf || null }
    : extractSpans(text, { asOf: opts.asOf });
  const spans = spanPack.spans || [];
  const grounded_states = AU_STATES.filter((s) => textMentionsState(textNorm, s));
  const pporGrounded = textGroundsPporOrInvestment(text);
  const fhbGrounded = textGroundsFhb(text);
  const anyStateMentioned = textMentionsAnyState(textNorm);

  (scenario.starting_properties || []).forEach((p, i) => {
    const path = `starting_properties[${i}]`;
    if (p.state) {
      if (!AU_STATES.includes(p.state) || !textMentionsState(textNorm, p.state)) {
        stripped.push(`${path}.state`);
        delete p.state;
        pushAssumption(scenario, {
          id: `ass_ground_state_start_${i}`,
          field_path: `${path}.state`,
          message: 'Which Australian state or territory is this property in? (Needed for stamp duty / duty calculations.)',
          severity: 'required',
        });
      }
    } else if (!anyStateMentioned) {
      pushAssumption(scenario, {
        id: `ass_ground_state_start_${i}`,
        field_path: `${path}.state`,
        message: 'Which Australian state or territory is this property in? (Needed for stamp duty / duty calculations.)',
        severity: 'required',
      });
    }

    if (typeof p.was_ever_investment_property === 'boolean') {
      if (!pporGrounded) {
        stripped.push(`${path}.was_ever_investment_property`);
        delete p.was_ever_investment_property;
        pushAssumption(scenario, {
          id: `ass_ground_ppor_start_${i}`,
          field_path: `${path}.was_ever_investment_property`,
          message: 'Has this property ever been used as an investment/rental, or has it always been your primary residence (PPOR)? (Affects CGT.)',
          severity: 'required',
        });
      }
    } else if (!pporGrounded) {
      pushAssumption(scenario, {
        id: `ass_ground_ppor_start_${i}`,
        field_path: `${path}.was_ever_investment_property`,
        message: 'Has this property ever been used as an investment/rental, or has it always been your primary residence (PPOR)? (Affects CGT.)',
        severity: 'required',
      });
    }

    if (p.current_loan) {
      groundLoanAgainstText(p.current_loan, `${path}.current_loan`, scenario, text, stripped, spans);
    }
  });

  (scenario.events || []).forEach((e, i) => {
    const fields = e.fields || {};
    const path = `events[${i}].fields`;

    if (fields.state) {
      if (!AU_STATES.includes(fields.state) || !textMentionsState(textNorm, fields.state)) {
        stripped.push(`${path}.state`);
        delete fields.state;
        pushAssumption(scenario, {
          id: `ass_ground_state_ev_${i}`,
          field_path: `${path}.state`,
          message: e.type === 'buy'
            ? 'Which Australian state or territory is the property you are buying in?'
            : 'Which Australian state or territory is the property you are selling in?',
          severity: 'required',
        });
      }
    } else if ((e.type === 'sell' || e.type === 'buy') && !anyStateMentioned) {
      pushAssumption(scenario, {
        id: `ass_ground_state_ev_${i}`,
        field_path: `${path}.state`,
        message: e.type === 'buy'
          ? 'Which Australian state or territory is the property you are buying in?'
          : 'Which Australian state or territory is the property you are selling in?',
        severity: 'required',
      });
    }

    if (typeof fields.was_ever_investment_property === 'boolean') {
      if (!pporGrounded) {
        stripped.push(`${path}.was_ever_investment_property`);
        delete fields.was_ever_investment_property;
        pushAssumption(scenario, {
          id: `ass_ground_ppor_ev_${i}`,
          field_path: `${path}.was_ever_investment_property`,
          message: 'Has this property ever been used as an investment/rental, or has it always been your primary residence (PPOR)? (Affects CGT.)',
          severity: 'required',
        });
      }
    } else if (e.type === 'sell' && !pporGrounded) {
      pushAssumption(scenario, {
        id: `ass_ground_ppor_ev_${i}`,
        field_path: `${path}.was_ever_investment_property`,
        message: 'Has this property ever been used as an investment/rental, or has it always been your primary residence (PPOR)? (Affects CGT.)',
        severity: 'required',
      });
    }

    if (typeof fields.is_first_home_buyer === 'boolean') {
      if (!fhbGrounded) {
        stripped.push(`${path}.is_first_home_buyer`);
        delete fields.is_first_home_buyer;
        pushAssumption(scenario, {
          id: `ass_ground_fhb_ev_${i}`,
          field_path: `${path}.is_first_home_buyer`,
          message: 'Are you a first home buyer for this purchase?',
          severity: 'required',
        });
      }
    } else if (e.type === 'buy' && !fhbGrounded) {
      pushAssumption(scenario, {
        id: `ass_ground_fhb_ev_${i}`,
        field_path: `${path}.is_first_home_buyer`,
        message: 'Are you a first home buyer for this purchase?',
        severity: 'required',
      });
    }

    if (fields.current_loan) {
      groundLoanAgainstText(fields.current_loan, `${path}.current_loan`, scenario, text, stripped, spans);
    }
    if (fields.target_loan) {
      groundLoanAgainstText(fields.target_loan, `${path}.target_loan`, scenario, text, stripped, spans);
    }
    if (fields.loan) {
      groundLoanAgainstText(fields.loan, `${path}.loan`, scenario, text, stripped, spans);
    }
  });

  // Stage 9: any remaining inventsed money/rate/date must match a pre-extracted span
  groundInventedNumericsAgainstSpans(scenario, spans, stripped);

  return { stripped, grounded_states, spans };
}


/**
 * Detect whether a Scenario still carries ungrounded critical fields (for tests / metrics).
 * @param {import('./scenario').Scenario} scenario
 * @param {string} sourceText
 * @param {{ spans?: object[] }} [opts]
 */
function findUngroundedCriticalFields(scenario, sourceText, opts = {}) {
  const textNorm = normalizeText(sourceText);
  const pporGrounded = textGroundsPporOrInvestment(sourceText);
  const fhbGrounded = textGroundsFhb(sourceText);
  const spans = opts.spans || extractSpans(sourceText).spans;
  const fixedGrounded = textGroundsFixedPeriodRemaining(sourceText);
  const termGrounded = textGroundsLoanTermRemaining(sourceText);
  const bad = [];

  function checkLoan(loan, loanPath) {
    if (!loan) return;
    const term = loan.term_remaining_months;
    const fixed = loan.fixed_period_remaining_months;
    const termOk = term == null
      || termGrounded
      || spanGroundsLoanTermMonths(spans, term, sourceText);
    const fixedOk = fixed == null
      || fixedGrounded
      || spanGroundsFixedPeriodMonths(spans, fixed, sourceText);
    if (term != null && !termOk) {
      bad.push(`${loanPath}.term_remaining_months=${term}`);
    }
    if (fixed != null && !fixedOk) {
      bad.push(`${loanPath}.fixed_period_remaining_months=${fixed}`);
    }
    if (
      Number.isFinite(Number(term))
      && Number.isFinite(Number(fixed))
      && Number(term) === Number(fixed)
      && !(termOk && fixedOk && termGrounded && fixedGrounded)
      && !(termGrounded && fixedGrounded)
    ) {
      // Equal months without both concepts grounded in text stays a conflation smell
      if (!(termGrounded && fixedGrounded)) {
        bad.push(`${loanPath}.equal_term_and_fixed_months=${term}`);
      }
    }
    if (loan.balance != null && !spanMatchesCurrency(spans, loan.balance)) {
      bad.push(`${loanPath}.balance=${loan.balance}`);
    }
    if (loan.rate != null && !spanMatchesPercent(spans, loan.rate)) {
      bad.push(`${loanPath}.rate=${loan.rate}`);
    }
  }

  (scenario.starting_properties || []).forEach((p, i) => {
    if (p.state && !textMentionsState(textNorm, p.state)) {
      bad.push(`starting_properties[${i}].state=${p.state}`);
    }
    if (typeof p.was_ever_investment_property === 'boolean' && !pporGrounded) {
      bad.push(`starting_properties[${i}].was_ever_investment_property=${p.was_ever_investment_property}`);
    }
    if (p.estimated_value != null && !spanMatchesCurrency(spans, p.estimated_value)) {
      bad.push(`starting_properties[${i}].estimated_value=${p.estimated_value}`);
    }
    checkLoan(p.current_loan, `starting_properties[${i}].current_loan`);
  });

  (scenario.events || []).forEach((e, i) => {
    const f = e.fields || {};
    if (f.state && !textMentionsState(textNorm, f.state)) {
      bad.push(`events[${i}].fields.state=${f.state}`);
    }
    if (typeof f.was_ever_investment_property === 'boolean' && !pporGrounded) {
      bad.push(`events[${i}].fields.was_ever_investment_property=${f.was_ever_investment_property}`);
    }
    if (typeof f.is_first_home_buyer === 'boolean' && !fhbGrounded) {
      bad.push(`events[${i}].fields.is_first_home_buyer=${f.is_first_home_buyer}`);
    }
    if (f.property_value != null && !spanMatchesCurrency(spans, f.property_value)) {
      bad.push(`events[${i}].fields.property_value=${f.property_value}`);
    }
    if (f.settlement_date && !spanMatchesDate(spans, f.settlement_date)) {
      bad.push(`events[${i}].fields.settlement_date=${f.settlement_date}`);
    }
    checkLoan(f.current_loan, `events[${i}].fields.current_loan`);
    checkLoan(f.target_loan, `events[${i}].fields.target_loan`);
    checkLoan(f.loan, `events[${i}].fields.loan`);
  });

  return bad;
}

module.exports = {
  STATE_ALIASES,
  groundScenarioAgainstText,
  findUngroundedCriticalFields,
  groundInventedNumericsAgainstSpans,
  textMentionsState,
  textGroundsPporOrInvestment,
  textGroundsFhb,
  textGroundsFixedPeriodRemaining,
  textGroundsLoanTermRemaining,
  groundLoanAgainstText,
};
