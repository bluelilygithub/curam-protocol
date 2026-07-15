'use strict';

const { roundMoney } = require('./tables');

/** Configurable default: margin (pp) above a reference standard variable rate for indicative bridging. */
const DEFAULT_BRIDGE_MARGIN_PP = 2.0;
/** Fallback SVR (% p.a.) when the scenario does not supply a reference variable rate. */
const DEFAULT_BASE_VARIABLE_RATE_PCT = 6.0;
/** When settlement dates are missing, assume this many days and caveat it. */
const DEFAULT_ASSUMED_GAP_DAYS = 60;

const BRIDGING_ELIGIBILITY_CAVEAT =
  'Bridging finance eligibility and serviceability are materially different from a standard home loan. '
  + 'Lenders often require the existing property to be unconditionally sold (or under contract with '
  + 'clear settlement), and impose specific LVR / peak-debt conditions. This module does not assess '
  + 'eligibility — obtain a broker/lender bridging quote before relying on any cost figure.';

const BRIDGING_RATE_CAVEAT =
  'The bridging interest rate used here is an indicative assumption (reference variable rate + margin), '
  + 'not a lender product quote. Actual bridging rates, fees, and peak-debt pricing vary widely.';

/**
 * Parse ISO date to UTC midnight ms, or null.
 * @param {string} iso
 * @returns {number|null}
 */
function parseIsoDateMs(iso) {
  if (!iso || typeof iso !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const ms = Date.parse(iso.slice(0, 10));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Resolve buy→sell settlement gap from the scenario + event results.
 * Prefers funds_deposit dependency that funds a bridging buy.
 *
 * @param {object} scenario
 * @param {object[]} [eventResults]
 * @returns {{
 *   buy_event_id: string|null,
 *   sell_event_id: string|null,
 *   buy_settlement_date: string|null,
 *   sell_settlement_date: string|null,
 *   gap_days: number|null,
 *   gap_assumed: boolean,
 *   notes: string[],
 * }}
 */
function resolveBridgingGapFromScenario(scenario, eventResults = []) {
  const notes = [];
  const buyResult = (eventResults || []).find(
    (e) => e.type === 'buy' && e.outputs?.bridging_required
  );
  const buyEvent = buyResult
    ? (scenario.events || []).find((e) => e.id === buyResult.event_id)
    : (scenario.events || []).find((e) => e.type === 'buy');

  const buyId = buyEvent?.id || null;
  const deps = (scenario.dependencies || []).filter(
    (d) => d.kind === 'funds_deposit' && (!buyId || d.to_event_id === buyId)
  );
  const sellEvent = deps
    .map((d) => (scenario.events || []).find((e) => e.id === d.from_event_id))
    .find(Boolean) || null;

  const buyDate = buyEvent?.fields?.settlement_date || null;
  const sellDate = sellEvent?.fields?.settlement_date || null;
  const buyMs = parseIsoDateMs(buyDate);
  const sellMs = parseIsoDateMs(sellDate);

  let gap_days = null;
  let gap_assumed = false;
  if (buyMs != null && sellMs != null) {
    gap_days = Math.round((sellMs - buyMs) / 86400000);
    if (gap_days < 0) {
      notes.push(
        `Sell settlement (${sellDate}) is before buy (${buyDate}) in stated dates — using absolute gap `
        + `${Math.abs(gap_days)} days for indicative interest only; confirm which date drives funding.`
      );
      gap_days = Math.abs(gap_days);
    } else if (gap_days === 0) {
      notes.push('Buy and sell share the same settlement date — gap modelled as 0 days (negligible IO interest).');
    }
  } else {
    gap_assumed = true;
    gap_days = DEFAULT_ASSUMED_GAP_DAYS;
    notes.push(
      `Settlement dates incomplete (buy=${buyDate || 'n/a'}, sell=${sellDate || 'n/a'}) — `
      + `assuming ${DEFAULT_ASSUMED_GAP_DAYS}-day bridging gap for indicative interest only.`
    );
  }

  return {
    buy_event_id: buyId,
    sell_event_id: sellEvent?.id || null,
    buy_settlement_date: buyDate,
    sell_settlement_date: sellDate,
    gap_days,
    gap_assumed,
    notes,
  };
}

/**
 * Bridging product modelling for a detected deposit shortfall / buy-before-sell gap.
 *
 * Always returns TWO paths — does not pick a recommendation:
 *  1. bridging_loan — indicative interest-only cost (supplementary)
 *  2. refuse_until_clarified — DEFAULT presented path (scenario not resolved without user input)
 *
 * @param {object} input
 * @param {number} input.shortfall_amount — dollars of funding gap
 * @param {number} [input.gap_days]
 * @param {number} [input.gap_months] — alternative to gap_days (×30.4375 ≈ average month)
 * @param {number} [input.base_variable_rate_pct] — reference SVR
 * @param {number} [input.bridge_margin_pp] — margin above SVR
 * @param {boolean} [input.buy_before_sell]
 * @param {boolean} [input.gap_assumed]
 * @returns {object}
 */
function calculateBridgingCost(input = {}) {
  const errors = [];
  const caveats = [BRIDGING_ELIGIBILITY_CAVEAT, BRIDGING_RATE_CAVEAT];
  const assumptions = [];

  const shortfall = Number(input.shortfall_amount);
  let gapDays = input.gap_days != null ? Number(input.gap_days) : null;
  if (!Number.isFinite(gapDays) && input.gap_months != null) {
    const months = Number(input.gap_months);
    if (Number.isFinite(months) && months >= 0) {
      gapDays = roundMoney(months * 30.4375);
      assumptions.push(`gap_months=${months} converted to ≈${gapDays} days (average month).`);
    }
  }

  const baseRate = input.base_variable_rate_pct != null
    ? Number(input.base_variable_rate_pct)
    : DEFAULT_BASE_VARIABLE_RATE_PCT;
  const marginPp = input.bridge_margin_pp != null
    ? Number(input.bridge_margin_pp)
    : DEFAULT_BRIDGE_MARGIN_PP;

  if (!Number.isFinite(shortfall) || shortfall < 0) {
    errors.push('shortfall_amount must be a non-negative number');
  }
  if (!Number.isFinite(gapDays) || gapDays < 0) {
    errors.push('gap_days (or gap_months) must be a non-negative number');
  }
  if (!Number.isFinite(baseRate) || baseRate < 0) {
    errors.push('base_variable_rate_pct must be a non-negative number');
  }
  if (!Number.isFinite(marginPp) || marginPp < 0) {
    errors.push('bridge_margin_pp must be a non-negative number');
  }

  if (input.base_variable_rate_pct == null) {
    assumptions.push(
      `Using default reference variable rate ${DEFAULT_BASE_VARIABLE_RATE_PCT}% p.a. `
      + '(override with base_variable_rate_pct).'
    );
  }
  if (input.bridge_margin_pp == null) {
    assumptions.push(
      `Using default bridging margin +${DEFAULT_BRIDGE_MARGIN_PP} pp above the reference variable rate `
      + '(override with bridge_margin_pp).'
    );
  }
  if (input.gap_assumed) {
    assumptions.push(`Gap period was assumed (${gapDays} days) — replace with confirmed settlement dates.`);
  }
  if (input.buy_before_sell) {
    caveats.push(
      'Buy-before-sell sequencing: sale proceeds are not available at buy settlement — '
      + 'bridging, other cash, or a reordered timeline is required.'
    );
  }

  const refusePath = {
    id: 'refuse_until_clarified',
    default_presented: true,
    title: 'Do not treat this scenario as resolved yet',
    summary:
      'This funding gap needs your input before the combined result can be treated as complete. '
      + 'Either (a) confirm bridging finance (or other cash) is arranged, or (b) change the scenario '
      + '(delay the purchase, increase the sales gap, reduce the shortfall / deposit need). '
      + 'The indicative bridging cost below is supplementary information only — not a recommendation '
      + 'to use bridging finance.',
    actions: [
      'confirm_bridging_arranged',
      'delay_purchase',
      'increase_sell_gap',
      'reduce_shortfall_or_deposit',
      'fund_shortfall_from_other_cash',
    ],
  };

  if (errors.length) {
    return {
      ok: false,
      errors,
      caveats,
      assumptions,
      explanation:
        'Could not estimate indicative bridging cost — check inputs. '
        + 'The refuse-until-clarified path still applies: do not treat the scenario as funded.',
      default_path: 'refuse_until_clarified',
      requires_user_decision: true,
      paths: {
        refuse_until_clarified: refusePath,
        bridging_loan: null,
      },
      shortfall_amount: Number.isFinite(shortfall) ? shortfall : null,
      gap_days: Number.isFinite(gapDays) ? gapDays : null,
      bridging_rate_pct: null,
      indicative_interest_cost: null,
    };
  }

  const bridgingRate = roundMoney(baseRate + marginPp);
  const yearFraction = gapDays / 365;
  const interest = roundMoney(shortfall * (bridgingRate / 100) * yearFraction);
  const monthlyIo = gapDays > 0
    ? roundMoney(shortfall * (bridgingRate / 100) / 12)
    : 0;

  const bridgingPath = {
    id: 'bridging_loan',
    default_presented: false,
    informational_only: true,
    title: 'Indicative bridging loan cost (interest-only)',
    summary:
      `If a bridging facility covered a $${shortfall.toLocaleString()} shortfall for ${gapDays} day(s) `
      + `at an indicative ${bridgingRate}% p.a. (interest-only), interest would be about `
      + `$${interest.toLocaleString()}. This is not a product recommendation and does not include `
      + 'establishment, valuation, legal, or peak-debt fees.',
    shortfall_amount: shortfall,
    gap_days: gapDays,
    base_variable_rate_pct: baseRate,
    bridge_margin_pp: marginPp,
    bridging_rate_pct: bridgingRate,
    indicative_interest_cost: interest,
    indicative_monthly_interest: monthlyIo,
    method: 'interest_only_simple',
    formula: 'shortfall × (bridging_rate/100) × (gap_days/365)',
  };

  const explanation =
    `Funding gap of $${shortfall.toLocaleString()} over ${gapDays} day(s). `
    + 'Default path: refuse until clarified (confirm bridging / other cash, or change the scenario). '
    + `Supplementary: indicative bridging IO interest ≈ $${interest.toLocaleString()} `
    + `at ${bridgingRate}% p.a. (${baseRate}% + ${marginPp} pp) — not a lender quote.`;

  return {
    ok: true,
    errors: [],
    caveats,
    assumptions,
    explanation,
    default_path: 'refuse_until_clarified',
    requires_user_decision: true,
    paths: {
      refuse_until_clarified: refusePath,
      bridging_loan: bridgingPath,
    },
    shortfall_amount: shortfall,
    gap_days: gapDays,
    bridging_rate_pct: bridgingRate,
    indicative_interest_cost: interest,
    buy_before_sell: Boolean(input.buy_before_sell),
  };
}

module.exports = {
  calculateBridgingCost,
  resolveBridgingGapFromScenario,
  DEFAULT_BRIDGE_MARGIN_PP,
  DEFAULT_BASE_VARIABLE_RATE_PCT,
  DEFAULT_ASSUMED_GAP_DAYS,
  BRIDGING_ELIGIBILITY_CAVEAT,
  BRIDGING_RATE_CAVEAT,
};
