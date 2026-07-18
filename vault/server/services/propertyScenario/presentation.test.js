#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { createScenario, createLoanSnapshot } = require('./scenario');
const { scenarioSellBuySwitchValid } = require('./fixtures');
const { runFromScenario } = require('./runPipeline');
const { runScenario: runScenarioDirect } = require('./orchestrate');
const {
  buildPresentationPayload,
  buildAdviceFromCalculation,
  buildFundingAlert,
  buildBreakEvenSeries,
} = require('./presentation');

const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[1m';
const X = '\x1b[0m';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`${G}✓${X} ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`${R}✗${X} ${name}`);
    console.log(`  ${err.stack || err.message}`);
  }
}

function buyBeforeSellScenario() {
  return createScenario({
    id: 'sc_buy_before_sell',
    title: 'Buy before sell (bridging)',
    starting_properties: [{
      id: 'prop_old',
      state: 'NSW',
      estimated_value: 900_000,
      purchase_price: 500_000,
      purchase_date: '2015-01-01',
      was_ever_investment_property: false,
      current_loan: createLoanSnapshot({
        balance: 200_000,
        rate: 5.5,
        fixed_or_variable: 'variable',
        term_remaining_months: 180,
        property_id: 'prop_old',
      }),
    }],
    events: [
      {
        id: 'ev_buy',
        type: 'buy',
        sequence: 1,
        label: 'Buy first',
        fields: {
          property_id: 'prop_new',
          property_value: 1_100_000,
          state: 'NSW',
          is_first_home_buyer: false,
          deposit_amount: 600_000,
          settlement_date: '2026-09-01',
          loan: createLoanSnapshot({
            balance: 500_000,
            rate: 5.4,
            fixed_or_variable: 'variable',
            term_remaining_months: 360,
          }),
        },
      },
      {
        id: 'ev_sell',
        type: 'sell',
        sequence: 2,
        label: 'Sell later',
        fields: {
          property_id: 'prop_old',
          property_value: 900_000,
          purchase_price: 500_000,
          purchase_date: '2015-01-01',
          was_ever_investment_property: false,
          state: 'NSW',
          settlement_date: '2026-10-01',
          selling_costs: 22_500,
        },
      },
    ],
    dependencies: [{
      id: 'dep_funds',
      from_event_id: 'ev_sell',
      to_event_id: 'ev_buy',
      kind: 'funds_deposit',
      note: 'Sale is meant to fund buy but settles later',
    }],
    unresolved_assumptions: [],
  });
}

test('presentation payload includes charts, tables, advice for compound scenario', () => {
  const scenario = scenarioSellBuySwitchValid();
  const { calculation, scenario: resolved } = runFromScenario(scenario, {
    clarifications: { selling_cost_pct: 0.025, clear_assumptions: true, resolve_optional: true },
  });
  const p = buildPresentationPayload({ scenario: resolved, calculation });
  assert.ok(p.charts.rate_comparison.length >= 3);
  assert.ok(p.charts.amortization.schedule.length >= 5);
  assert.ok(p.charts.break_even.series.length > 10);
  assert.ok(p.charts.cumulative_cost.series.length > 5);
  assert.ok(p.summary_table.totals.some((r) => r.key === 'stamp_duty'));
  assert.ok(p.lenders.rows.length >= 3);
  assert.ok(p.advice.follow_up_questions.length >= 2 && p.advice.follow_up_questions.length <= 3);
  assert.ok(p.advice.raise_with_broker_or_tax_agent.length >= 1);
  assert.ok(p.calculators.repayment.ok);
  assert.ok(p.stub_notice);
  assert.strictEqual(p.funding_alert, null);
  assert.strictEqual(calculation.bridging_required, false);
});

test('CGT caveats drive a 6-year-rule follow-up when present', () => {
  const advice = buildAdviceFromCalculation({
    caveats: [
      '6-year rule / partial main-residence exemption: if you lived in the property and later rented it',
    ],
    assumptions: [],
    totals: {},
  });
  assert.ok(advice.follow_up_questions.some((q) => /6-year/i.test(q)));
  assert.ok(advice.raise_with_broker_or_tax_agent.some((r) => /tax agent|CGT/i.test(r)));
});

test('LMI caveat maps to LMI follow-up (not a generic filler)', () => {
  const advice = buildAdviceFromCalculation({
    caveats: ['Lenders and insurers price LMI differently — treat this as order-of-magnitude only.'],
    assumptions: [],
    totals: {},
  });
  assert.ok(advice.follow_up_questions.some((q) => /LMI/i.test(q)));
});

test('stamp duty caveat maps to duty concession follow-up', () => {
  const advice = buildAdviceFromCalculation({
    caveats: ['Stamp duty brackets are an estimator — confirm with the state revenue office.'],
    assumptions: [],
    totals: { stamp_duty: 50000 },
  });
  assert.ok(advice.follow_up_questions.some((q) => /duty|first-home/i.test(q)));
  assert.ok(advice.raise_with_broker_or_tax_agent.some((r) => /stamp duty/i.test(r)));
});

test('break-cost caveat maps to formal quote follow-up', () => {
  const advice = buildAdviceFromCalculation({
    caveats: ['Fixed-rate early-repayment / IRD break costs may apply separately.'],
    assumptions: [],
    totals: {},
  });
  assert.ok(advice.follow_up_questions.some((q) => /break-cost|break cost/i.test(q)));
});

test('bridging_required flag drives bridging follow-up without loose unused-proceeds match', () => {
  const advice = buildAdviceFromCalculation({
    caveats: [],
    assumptions: [],
    totals: { unused_sale_proceeds: 100000, bridging_required: true, deposit_shortfall: 600000 },
    bridging_required: true,
    deposit_shortfall: 600000,
  });
  assert.ok(advice.follow_up_questions.some((q) => /bridging|decision|delay/i.test(q)));
});

test('buildFundingAlert is null for clean compound scenario', () => {
  assert.strictEqual(buildFundingAlert({ bridging_required: false, totals: { deposit_shortfall: 0 } }), null);
});

test('buildFundingAlert surfaces shortfall message for UI banner', () => {
  const alert = buildFundingAlert({
    bridging_required: true,
    deposit_shortfall: 600000,
    totals: { deposit_shortfall: 600000, bridging_required: true },
  });
  assert.ok(alert);
  assert.strictEqual(alert.bridging_required, true);
  assert.strictEqual(alert.deposit_shortfall, 600000);
  assert.strictEqual(alert.requires_user_decision, true);
  assert.strictEqual(alert.default_path, 'refuse_until_clarified');
  assert.ok(/not fully resolved|shortfall|Confirm bridging/i.test(alert.message));
});

test('buy-before-sell sets bridging_required + deposit_shortfall (not silent)', () => {
  const scenario = buyBeforeSellScenario();
  const calculation = runScenarioDirect(scenario, { force: true });
  assert.strictEqual(calculation.bridging_required, true);
  assert.ok(calculation.deposit_shortfall >= 600000, `shortfall=${calculation.deposit_shortfall}`);
  assert.ok(calculation.funding_alert);
  assert.strictEqual(calculation.funding_alert.bridging_required, true);
  assert.strictEqual(calculation.requires_user_decision, true);
  assert.strictEqual(calculation.ready, false);
  assert.strictEqual(calculation.funding_alert.default_path, 'refuse_until_clarified');
  assert.ok(calculation.bridging_modeling);
  assert.strictEqual(calculation.bridging_modeling.default_path, 'refuse_until_clarified');
  assert.ok(calculation.bridging_modeling.paths.bridging_loan.indicative_interest_cost > 0);
  assert.ok(calculation.caveats.some((c) => /BRIDGING \/ FUNDING GAP/i.test(c)));
  assert.ok(calculation.caveats.some((c) => /eligibility and serviceability/i.test(c)));

  const buy = calculation.event_results.find((e) => e.type === 'buy');
  assert.strictEqual(buy.outputs.bridging_required, true);
  assert.strictEqual(buy.outputs.buy_before_sell, true);
  assert.ok(buy.outputs.deposit_shortfall >= 600000);

  const p = buildPresentationPayload({ scenario, calculation });
  assert.ok(p.funding_alert);
  assert.strictEqual(p.funding_alert.bridging_required, true);
  assert.strictEqual(p.requires_user_decision, true);
  assert.strictEqual(p.ready, false);
  assert.match(p.funding_alert.message, /not fully resolved/i);
  assert.ok(p.funding_alert.bridging_modeling?.paths?.bridging_loan);
  assert.ok(p.advice.follow_up_questions.some((q) => /bridging|decision|delay/i.test(q)));
});

test('healthy sell→buy compound does not invent a funding alert', () => {
  const scenario = scenarioSellBuySwitchValid();
  const { calculation } = runFromScenario(scenario, {
    clarifications: { selling_cost_pct: 0.025, clear_assumptions: true, resolve_optional: true },
  });
  assert.strictEqual(calculation.bridging_required, false);
  assert.strictEqual(calculation.deposit_shortfall, 0);
  assert.strictEqual(calculation.funding_alert, null);
});

test('live CDR lenders replace stubs and clear stub_notice', () => {
  const scenario = scenarioSellBuySwitchValid();
  const { calculation } = runFromScenario(scenario, {
    clarifications: { selling_cost_pct: 0.025, clear_assumptions: true, resolve_optional: true },
  });
  const live = [
    {
      id: 'commbank_digi',
      name: 'Digi Home Loan',
      lender: 'CommBank',
      rate: 6.09,
      comparison_rate: 6.22,
      fixed_or_variable: 'variable',
      upfront_fees: 0,
      ongoing_annual_fees: 0,
      offset: true,
      redraw: true,
      source: 'cdr_prd',
      stub: false,
      links: { terms: 'https://example.com/terms.pdf' },
    },
  ];
  const p = buildPresentationPayload({
    scenario,
    calculation,
    liveLenders: live,
    coverage: { summary: '1/1 lenders OK', succeeded: ['CommBank'], failed: [] },
  });
  assert.strictEqual(p.lender_source, 'cdr_prd');
  assert.strictEqual(p.stub_notice, null);
  assert.strictEqual(p.lenders.rows[0].stub, false);
  assert.strictEqual(p.lenders.rows[0].rate, 6.09);
  assert.strictEqual(p.lenders.rows[0].provenance, 'cdr_prd');
  assert.strictEqual(p.lenders.rows[0].provenance_label, 'CDR');
  assert.match(p.lenders.data_note, /Live CDR/);
});

test('stub fallback rows are labeled MOCK with mock provenance', () => {
  const scenario = scenarioSellBuySwitchValid();
  const { calculation } = runFromScenario(scenario, {
    clarifications: { selling_cost_pct: 0.025, clear_assumptions: true, resolve_optional: true },
  });
  const p = buildPresentationPayload({
    scenario,
    calculation,
    lenderFetchError: 'simulated outage',
  });
  assert.strictEqual(p.lender_source, 'stub');
  assert.ok(p.stub_notice);
  assert.ok(p.lenders.rows.every((r) => r.stub === true));
  assert.ok(p.lenders.rows.every((r) => r.provenance === 'mock'));
  assert.ok(p.lenders.rows.every((r) => r.provenance_label === 'MOCK'));
});

test('refinance-only scenario (no buy event) uses the actual loan balance, not the $1.2M/30yr placeholder', () => {
  // Regression test for a 2026-07-18 bug: buildPresentationPayload's loan/term/rate
  // resolution only ever checked `buy` events for the balance, so any switch_lender
  // / refinance-only scenario (the structured-form path with no buy event) silently
  // fell through to the hardcoded $1,200,000 / 360-month / 5.29% defaults for the
  // calculator snapshots, lender comparison table, and amortization/cumulative charts
  // — regardless of the user's real loan size.
  const scenario = {
    id: 'sc_refi_only',
    events: [
      {
        type: 'switch_lender',
        sequence: 1,
        fields: {
          current_loan: {
            balance: 100000,
            rate: 6.2,
            fixed_or_variable: 'variable',
            term_remaining_months: 48,
            state: 'QLD',
          },
          target_loan: {
            balance: 100000,
            rate: 5.95,
            fixed_or_variable: 'variable',
            term_remaining_months: 48,
          },
        },
      },
    ],
  };
  const calculation = { ready: true, totals: {}, caveats: [], assumptions: [] };
  const p = buildPresentationPayload({ scenario, calculation });

  assert.strictEqual(p.calculators.repayment.loan_amount, 100000);
  assert.strictEqual(p.calculators.repayment.term_months, 48);
  assert.strictEqual(p.calculators.repayment.annual_rate_pct, 5.95);
  assert.ok(
    !/1,200,000/.test(p.calculators.repayment.explanation),
    `repayment explanation leaked the $1.2M placeholder: ${p.calculators.repayment.explanation}`
  );

  assert.ok(
    !/1,200,000/.test(p.calculators.extra_repayments.explanation),
    `extra_repayments explanation leaked the $1.2M placeholder: ${p.calculators.extra_repayments.explanation}`
  );
  assert.ok(
    !/1,200,000/.test(p.calculators.offset.explanation),
    `offset explanation leaked the $1.2M placeholder: ${p.calculators.offset.explanation}`
  );

  // Lender comparison + charts share the same resolved loan/term — must also be $100k/48mo.
  assert.ok(p.lenders.rows.length > 0);
  assert.ok(
    p.lenders.rows.every((r) => r.monthly_repayment < 5000),
    `lender row repayments look like they used the $1.2M placeholder: ${JSON.stringify(p.lenders.rows.map((r) => r.monthly_repayment))}`
  );
  assert.strictEqual(p.charts.amortization.schedule.length <= 5, true);
});

// refinance-only scenario using the `refinance` event-type alias (route accepts both
// 'switch_lender' and 'refinance') must resolve identically — not silently regress
// to the buy-only lookup because of a type-name mismatch.
test('refinance event-type alias resolves the same as switch_lender', () => {
  const scenario = {
    id: 'sc_refi_alias',
    events: [
      {
        type: 'refinance',
        sequence: 1,
        fields: {
          current_loan: { balance: 250000, rate: 6.0, fixed_or_variable: 'variable', term_remaining_months: 200 },
          target_loan: { balance: 250000, rate: 5.8, fixed_or_variable: 'variable', term_remaining_months: 200 },
        },
      },
    ],
  };
  const calculation = { ready: true, totals: {}, caveats: [], assumptions: [] };
  const p = buildPresentationPayload({ scenario, calculation });
  assert.strictEqual(p.calculators.repayment.loan_amount, 250000);
  assert.strictEqual(p.calculators.repayment.term_months, 200);
  assert.strictEqual(p.calculators.repayment.annual_rate_pct, 5.8);
});

// ─── buildBreakEvenSeries ────────────────────────────────────────────────────

// GAP: buildBreakEvenSeries was only ever exercised indirectly (via a healthy compound
// scenario with a positive saving). No test covered a switch/refinance where the new
// repayment is *higher* than the old one (monthly_saving < 0) — must produce a flat $0
// cumulative_savings line (never break even) rather than a misleading negative-savings
// projection, and must not throw on the null break_even_months.
test('buildBreakEvenSeries: negative monthly saving flatlines savings at $0, never breaks even', () => {
  const calculation = {
    event_results: [{
      type: 'switch_lender',
      outputs: {
        refinance_break_even: {
          ok: true,
          upfront_cost: 1_500,
          monthly_saving: -75,
          break_even_months: null,
        },
        break_cost: { break_cost_estimate: 0 },
      },
    }],
  };
  const series = buildBreakEvenSeries(calculation);
  assert.strictEqual(series.break_even_months, null);
  assert.ok(series.series.length > 0);
  assert.ok(series.series.every((p) => p.cumulative_savings === 0), 'negative saving must never accumulate a positive/negative savings line');
  assert.ok(series.series.every((p) => p.cumulative_cost === 1_500));
  assert.match(series.note, /no modelled monthly saving/i);
});

// GAP: monthly_saving exactly $0 (identical repayment) was untested — must behave the
// same as the negative case (flat $0 line), not divide-by-zero or project a break-even.
test('buildBreakEvenSeries: zero monthly saving also flatlines (no divide-by-zero)', () => {
  const calculation = {
    event_results: [{
      type: 'refinance',
      outputs: {
        refinance_break_even: {
          ok: true,
          upfront_cost: 900,
          monthly_saving: 0,
          break_even_months: null,
        },
        break_cost: null,
      },
    }],
  };
  const series = buildBreakEvenSeries(calculation);
  assert.strictEqual(series.break_even_months, null);
  assert.ok(series.series.every((p) => p.cumulative_savings === 0));
  assert.ok(Number.isFinite(series.series[series.series.length - 1].month));
});

// GAP: a genuinely positive saving was never checked against buildBreakEvenSeries in
// isolation (only end-to-end via a full scenario) — lock in that the horizon stretches
// far enough for cumulative_savings to actually overtake cumulative_cost.
test('buildBreakEvenSeries: positive saving series crosses cumulative cost by break-even month', () => {
  const calculation = {
    event_results: [{
      type: 'switch_lender',
      outputs: {
        refinance_break_even: {
          ok: true,
          upfront_cost: 2_000,
          monthly_saving: 100,
          break_even_months: 20,
        },
        break_cost: { break_cost_estimate: 0 },
      },
    }],
  };
  const series = buildBreakEvenSeries(calculation);
  assert.strictEqual(series.break_even_months, 20);
  const atBreakEven = series.series.find((p) => p.month === 20);
  assert.ok(atBreakEven);
  assert.ok(atBreakEven.cumulative_savings >= atBreakEven.cumulative_cost);
  const beforeBreakEven = series.series.find((p) => p.month === 5);
  assert.ok(beforeBreakEven.cumulative_savings < beforeBreakEven.cumulative_cost);
});

console.log(`\n${B}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
process.exit(failed ? 1 : 0);
