#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  calculateBridgingCost,
  resolveBridgingGapFromScenario,
  DEFAULT_BRIDGE_MARGIN_PP,
  DEFAULT_BASE_VARIABLE_RATE_PCT,
  BRIDGING_ELIGIBILITY_CAVEAT,
} = require('./bridgingCost');
const { createScenario, createLoanSnapshot } = require('../scenario');
const { runScenario } = require('../orchestrate');
const { buildPresentationPayload, buildFundingAlert } = require('../presentation');

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

test('worked example: $600k × 8% × 30/365 ≈ $3,945.21 IO interest', () => {
  const result = calculateBridgingCost({
    shortfall_amount: 600_000,
    gap_days: 30,
    base_variable_rate_pct: 6.0,
    bridge_margin_pp: 2.0,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.bridging_rate_pct, 8);
  assert.strictEqual(result.indicative_interest_cost, 3945.21);
  assert.strictEqual(result.paths.bridging_loan.indicative_interest_cost, 3945.21);
  assert.strictEqual(result.paths.bridging_loan.gap_days, 30);
  assert.match(result.paths.bridging_loan.summary, /not a product recommendation/i);
});

test('refuse_until_clarified is the default path; bridging is informational', () => {
  const result = calculateBridgingCost({
    shortfall_amount: 100_000,
    gap_days: 60,
  });
  assert.strictEqual(result.default_path, 'refuse_until_clarified');
  assert.strictEqual(result.requires_user_decision, true);
  assert.strictEqual(result.paths.refuse_until_clarified.default_presented, true);
  assert.strictEqual(result.paths.bridging_loan.default_presented, false);
  assert.strictEqual(result.paths.bridging_loan.informational_only, true);
  assert.ok(result.caveats.includes(BRIDGING_ELIGIBILITY_CAVEAT));
  assert.ok(result.caveats.some((c) => /not a lender product quote/i.test(c)));
  // Defaults applied
  assert.strictEqual(
    result.paths.bridging_loan.base_variable_rate_pct,
    DEFAULT_BASE_VARIABLE_RATE_PCT
  );
  assert.strictEqual(result.paths.bridging_loan.bridge_margin_pp, DEFAULT_BRIDGE_MARGIN_PP);
});

test('resolveBridgingGapFromScenario uses settlement dates (Sep 1 → Oct 1 = 30 days)', () => {
  const scenario = buyBeforeSellScenario();
  const gap = resolveBridgingGapFromScenario(scenario, [
    { event_id: 'ev_buy', type: 'buy', outputs: { bridging_required: true } },
  ]);
  assert.strictEqual(gap.gap_days, 30);
  assert.strictEqual(gap.gap_assumed, false);
  assert.strictEqual(gap.buy_settlement_date, '2026-09-01');
  assert.strictEqual(gap.sell_settlement_date, '2026-10-01');
});

test('orchestrator attaches bridging_modeling + requires_user_decision (refuse default)', () => {
  const scenario = buyBeforeSellScenario();
  const calculation = runScenario(scenario, { force: true });

  assert.strictEqual(calculation.bridging_required, true);
  assert.ok(calculation.deposit_shortfall >= 600_000);
  assert.strictEqual(calculation.requires_user_decision, true);
  assert.strictEqual(calculation.ready, false);
  assert.ok(calculation.funding_alert);
  assert.strictEqual(calculation.funding_alert.default_path, 'refuse_until_clarified');
  assert.strictEqual(calculation.funding_alert.requires_user_decision, true);
  assert.match(calculation.funding_alert.message, /not fully resolved/i);
  assert.match(calculation.funding_alert.message, /informative only/i);

  const modeling = calculation.bridging_modeling;
  assert.ok(modeling);
  assert.strictEqual(modeling.default_path, 'refuse_until_clarified');
  assert.ok(modeling.paths.refuse_until_clarified.default_presented);
  assert.ok(modeling.paths.bridging_loan);
  assert.strictEqual(modeling.gap_days, 30);
  // 5.4% loan + 2pp default margin = 7.4%
  assert.strictEqual(modeling.bridging_rate_pct, 7.4);
  assert.strictEqual(modeling.indicative_interest_cost, 3649.32);
  // Must not add bridging interest into committed totals
  assert.ok(!('bridging_interest' in calculation.totals));
});

test('Stage 6 funding_alert keeps input-first messaging with cost as secondary detail', () => {
  const scenario = buyBeforeSellScenario();
  const calculation = runScenario(scenario, { force: true });
  const alert = buildFundingAlert(calculation);
  assert.ok(alert);
  assert.strictEqual(alert.requires_user_decision, true);
  assert.strictEqual(alert.default_path, 'refuse_until_clarified');
  assert.match(alert.title, /decision needed/i);
  assert.match(alert.message, /not fully resolved/i);
  assert.ok(!/recommended to bridge/i.test(alert.message));
  assert.ok(alert.bridging_modeling?.paths?.bridging_loan?.indicative_interest_cost > 0);

  const p = buildPresentationPayload({ scenario, calculation });
  assert.strictEqual(p.requires_user_decision, true);
  assert.strictEqual(p.ready, false);
  assert.strictEqual(p.funding_alert.default_path, 'refuse_until_clarified');
  assert.ok(p.funding_alert.bridging_modeling);
  // Cost must not be the only/headline signal — primary still needs decision
  assert.match(p.funding_alert.message, /not fully resolved|your decision|Confirm bridging/i);
  assert.ok(p.advice.follow_up_questions.some((q) => /decision|bridging|delay/i.test(q)));
});

console.log(`\n${B}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
process.exit(failed ? 1 : 0);
