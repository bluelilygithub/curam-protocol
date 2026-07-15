'use strict';

/**
 * Stage 1 fixtures + Stage 2 NLP ground truth.
 *
 * Each GROUND_TRUTH case pairs free-text `source_text` with the exact Scenario
 * the NLP parser must produce (`expected`). Ids in `expected` are stable fixture
 * ids — Stage 2 should instruct the model (or a post-pass) to emit these
 * canonical ids so deep equality works without remapping.
 *
 * Do not invent parallel cases in Stage 2; extend this file instead.
 */

const { createScenario, createLoanSnapshot } = require('./scenario');

/** Shared home already owned at scenario start. */
const CURRENT_HOME = {
  id: 'prop_current_home',
  label: '12 Maple St, Marrickville',
  state: 'NSW',
  estimated_value: 1_450_000,
  purchase_price: 820_000,
  purchase_date: '2016-04-12',
  was_ever_investment_property: false,
  current_loan: createLoanSnapshot({
    balance: 410_000,
    rate: 5.89,
    fixed_or_variable: 'variable',
    term_remaining_months: 216,
    lender: 'BigBank',
    property_id: 'prop_current_home',
  }),
};

// ─── Natural-language source texts (parser inputs) ───────────────────────────

/**
 * Ground-truth input for sell → buy → switch lender.
 * Deliberately omits agent/conveyancing costs → unresolved_assumptions.ass_selling_costs.
 */
const SOURCE_TEXT_SELL_BUY_SWITCH = `
I own 12 Maple St in Marrickville, NSW — bought it for $820,000 on 12 April 2016,
never used as an investment property. It's worth about $1,450,000 now with $410,000
still owing to BigBank on a variable loan at 5.89% with 216 months left.

I want to sell Maple St around mid-September 2026 (settlement 15 September 2026)
for that $1,450,000 value. Then about two weeks later I buy a duplex in Randwick,
NSW for $1,850,000 settling 30 September 2026. I'm not a first home buyer.
The deposit of $650,000 comes from the Maple St sale proceeds after clearing that
mortgage. I'll borrow $1,200,000 from BigBank on the new place — variable, 5.74%,
30-year term (360 months).

A couple of months after that I switch the new loan from BigBank to OnlineBank:
same $1,200,000 balance, but move to a fixed rate of 5.29% for 360 months again.
At switch time the remaining term at BigBank is about 358 months.
`.trim().replace(/\s+/g, ' ');

/**
 * Ground-truth input for refinance PPOR → early payout (IP stays).
 * Deliberately omits fixed-rate break costs → unresolved_assumptions.ass_break_costs.
 */
const SOURCE_TEXT_REFI_PAYOUT = `
I have two properties. My home (PPOR) has a CityBank fixed loan of $520,000 at 6.1%
with 180 months left on the loan overall, and about 24 months left on the fixed-rate
period. I also own an investment unit in Victoria worth about $620,000
that I bought for $480,000 on 1 November 2019 — always been an investment — with
$380,000 owing to CityBank variable at 5.95% over 300 months remaining.

I want to refinance just the home loan with CityBank: pay the balance down a bit to
$500,000, switch from fixed to variable at 5.4%, and stretch the term to 300 months.
About six months later (around 1 March 2027) I get a bonus and early-payout the home
loan when only about $80,000 is left at 5.4% variable with 240 months showing on
the remaining loan term. Leave the investment property and its loan alone.
`.trim().replace(/\s+/g, ' ');

/**
 * Optional NL for the invalid sell case — used for negative parser/validation tests,
 * not as a success ground-truth pair for Stage 2.
 */
const SOURCE_TEXT_SELL_UNKNOWN = `
I'm going to sell a Queensland investment I bought in 2018 for $500,000 — expect
about $900,000 — and use that money as a first-home-buyer deposit on a $700,000
place also in Queensland. (I never listed this property as something I already own.)
`.trim().replace(/\s+/g, ' ');

// ─── Structured expected outputs ─────────────────────────────────────────────

/**
 * Scenario A — Sell current home → buy new home → switch lender on the new loan.
 * Includes intentional invalid self-dependency for negative structural tests only.
 */
function scenarioSellBuySwitch() {
  return createScenario({
    id: 'sc_sell_buy_switch',
    title: 'Upsize then refinance to a sharper lender',
    starting_properties: [CURRENT_HOME],
    events: [
      {
        id: 'ev_sell_home',
        type: 'sell',
        sequence: 1,
        label: 'Sell Maple St',
        fields: {
          property_id: 'prop_current_home',
          property_value: 1_450_000,
          purchase_price: 820_000,
          purchase_date: '2016-04-12',
          was_ever_investment_property: false,
          state: 'NSW',
          settlement_date: '2026-09-15',
        },
      },
      {
        id: 'ev_buy_new',
        type: 'buy',
        sequence: 2,
        label: 'Buy Randwick duplex',
        fields: {
          property_id: 'prop_new_home',
          property_value: 1_850_000,
          state: 'NSW',
          is_first_home_buyer: false,
          deposit_source: 'sale proceeds from Maple St',
          deposit_amount: 650_000,
          settlement_date: '2026-09-30',
          loan: createLoanSnapshot({
            balance: 1_200_000,
            rate: 5.74,
            fixed_or_variable: 'variable',
            term_remaining_months: 360,
            lender: 'BigBank',
            property_id: 'prop_new_home',
          }),
        },
      },
      {
        id: 'ev_switch_lender',
        type: 'switch_lender',
        sequence: 3,
        label: 'Refinance to OnlineBank',
        fields: {
          property_id: 'prop_new_home',
          current_loan: createLoanSnapshot({
            balance: 1_200_000,
            rate: 5.74,
            fixed_or_variable: 'variable',
            term_remaining_months: 358,
            lender: 'BigBank',
            property_id: 'prop_new_home',
          }),
          target_loan: createLoanSnapshot({
            balance: 1_200_000,
            rate: 5.29,
            fixed_or_variable: 'fixed',
            term_remaining_months: 360,
            lender: 'OnlineBank',
            property_id: 'prop_new_home',
          }),
        },
      },
    ],
    dependencies: [
      {
        id: 'dep_sale_funds_deposit',
        from_event_id: 'ev_sell_home',
        to_event_id: 'ev_buy_new',
        kind: 'funds_deposit',
        note: 'Net sale proceeds after discharging Maple St mortgage fund the deposit',
      },
      {
        id: 'dep_sell_clears_loan',
        from_event_id: 'ev_sell_home',
        to_event_id: 'ev_sell_home',
        kind: 'clears_loan',
        note: 'INVALID self-link — used only in negative tests; valid scenarios omit this',
      },
    ],
    timeline: {
      gaps: [
        {
          after_event_id: 'ev_sell_home',
          before_event_id: 'ev_buy_new',
          assumed_days: 15,
          note: 'Assumed settlement overlap window of ~2 weeks',
        },
      ],
      overlaps: [],
    },
    unresolved_assumptions: [
      {
        id: 'ass_selling_costs',
        field_path: 'events[0].fields.selling_costs',
        message: 'Agent + conveyancing costs not provided — assumed 2.5% of sale price later',
        severity: 'optional',
      },
    ],
  });
}

/** Valid variant of Scenario A — Stage 2 NLP expected output. */
function scenarioSellBuySwitchValid() {
  const s = scenarioSellBuySwitch();
  s.dependencies = s.dependencies.filter((d) => d.id === 'dep_sale_funds_deposit');
  return s;
}

/**
 * Scenario B — Keep investment property; refinance primary; early payout of residual.
 */
function scenarioRefinanceThenPayout() {
  return createScenario({
    id: 'sc_refi_payout',
    title: 'Refinance then early payout from bonus',
    starting_properties: [
      {
        id: 'prop_ppor',
        label: 'PPOR',
        state: 'NSW',
        current_loan: createLoanSnapshot({
          balance: 520_000,
          rate: 6.1,
          fixed_or_variable: 'fixed',
          term_remaining_months: 180,
          fixed_period_remaining_months: 24,
          lender: 'CityBank',
          property_id: 'prop_ppor',
        }),
      },
      {
        id: 'prop_ip',
        label: 'Investment unit',
        state: 'VIC',
        estimated_value: 620_000,
        purchase_price: 480_000,
        purchase_date: '2019-11-01',
        was_ever_investment_property: true,
        current_loan: createLoanSnapshot({
          balance: 380_000,
          rate: 5.95,
          fixed_or_variable: 'variable',
          term_remaining_months: 300,
          lender: 'CityBank',
          property_id: 'prop_ip',
        }),
      },
    ],
    events: [
      {
        id: 'ev_refi_ppor',
        type: 'refinance',
        sequence: 1,
        fields: {
          property_id: 'prop_ppor',
          current_loan: createLoanSnapshot({
            balance: 520_000,
            rate: 6.1,
            fixed_or_variable: 'fixed',
            term_remaining_months: 180,
            fixed_period_remaining_months: 24,
            lender: 'CityBank',
            property_id: 'prop_ppor',
          }),
          target_loan: createLoanSnapshot({
            balance: 500_000,
            rate: 5.4,
            fixed_or_variable: 'variable',
            term_remaining_months: 300,
            lender: 'CityBank',
            property_id: 'prop_ppor',
          }),
        },
      },
      {
        id: 'ev_early_payout',
        type: 'early_payout',
        sequence: 2,
        fields: {
          property_id: 'prop_ppor',
          current_loan: createLoanSnapshot({
            balance: 80_000,
            rate: 5.4,
            fixed_or_variable: 'variable',
            term_remaining_months: 240,
            lender: 'CityBank',
            property_id: 'prop_ppor',
          }),
          payout_date: '2027-03-01',
        },
      },
    ],
    dependencies: [],
    timeline: {
      gaps: [
        {
          after_event_id: 'ev_refi_ppor',
          before_event_id: 'ev_early_payout',
          assumed_days: 180,
          note: 'Bonus expected ~6 months after refinance',
        },
      ],
      overlaps: [],
    },
    unresolved_assumptions: [
      {
        id: 'ass_break_costs',
        field_path: 'events[0].fields.current_loan.break_cost',
        message: 'Fixed-rate break costs not supplied',
        severity: 'required',
      },
    ],
  });
}

/**
 * Scenario C — Invalid: sell a property that never existed / was never bought.
 * Validation / negative tests only — not a Stage 2 success ground-truth case.
 */
function scenarioSellUnknownProperty() {
  return createScenario({
    id: 'sc_invalid_sell',
    title: 'Sell something we do not own',
    starting_properties: [],
    events: [
      {
        id: 'ev_sell_ghost',
        type: 'sell',
        sequence: 1,
        fields: {
          property_id: 'prop_does_not_exist',
          property_value: 900_000,
          purchase_price: 500_000,
          purchase_date: '2018-01-01',
          was_ever_investment_property: true,
          state: 'QLD',
        },
      },
      {
        id: 'ev_buy_after',
        type: 'buy',
        sequence: 2,
        fields: {
          property_id: 'prop_new',
          property_value: 700_000,
          state: 'QLD',
          is_first_home_buyer: true,
          deposit_source: 'savings',
        },
      },
    ],
    dependencies: [
      {
        id: 'dep_bad',
        from_event_id: 'ev_sell_ghost',
        to_event_id: 'ev_buy_after',
        kind: 'funds_deposit',
      },
    ],
    timeline: { gaps: [], overlaps: [] },
    unresolved_assumptions: [],
  });
}

// ─── Ground-truth pairs for Stage 2 NLP ──────────────────────────────────────

/**
 * @typedef {object} GroundTruthCase
 * @property {string} id
 * @property {string} name
 * @property {string} source_text — free-text parser input
 * @property {import('./scenario').Scenario} expected — exact structured output
 * @property {'success'} kind
 */

/** @type {GroundTruthCase[]} */
const GROUND_TRUTH_CASES = [
  {
    id: 'gt_sell_buy_switch',
    name: 'Sell → buy → switch lender',
    source_text: SOURCE_TEXT_SELL_BUY_SWITCH,
    expected: scenarioSellBuySwitchValid(),
    kind: 'success',
  },
  {
    id: 'gt_refi_payout',
    name: 'Refinance PPOR → early payout',
    source_text: SOURCE_TEXT_REFI_PAYOUT,
    expected: scenarioRefinanceThenPayout(),
    kind: 'success',
  },
];

/**
 * Negative examples: NL may parse into a scenario that must fail validateScenario,
 * or that the parser should flag via unresolved_assumptions / validation errors.
 */
const NEGATIVE_CASES = [
  {
    id: 'neg_sell_unknown',
    name: 'Sell property not in starting portfolio',
    source_text: SOURCE_TEXT_SELL_UNKNOWN,
    expected: scenarioSellUnknownProperty(),
    kind: 'validation_error',
  },
];

module.exports = {
  CURRENT_HOME,
  SOURCE_TEXT_SELL_BUY_SWITCH,
  SOURCE_TEXT_REFI_PAYOUT,
  SOURCE_TEXT_SELL_UNKNOWN,
  scenarioSellBuySwitch,
  scenarioSellBuySwitchValid,
  scenarioRefinanceThenPayout,
  scenarioSellUnknownProperty,
  GROUND_TRUTH_CASES,
  NEGATIVE_CASES,
};
