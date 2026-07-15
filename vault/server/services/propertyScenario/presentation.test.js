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

console.log(`\n${B}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
process.exit(failed ? 1 : 0);
