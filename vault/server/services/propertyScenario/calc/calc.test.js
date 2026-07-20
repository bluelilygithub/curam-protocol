#!/usr/bin/env node
/**
 * Stage 3 calculation modules — unit tests (no API).
 * Run: node server/services/propertyScenario/calc/calc.test.js
 */
'use strict';

const assert = require('assert');
const { dutyFromBrackets, STAMP_DUTY_TABLES, roundMoney } = require('./tables');
const { calculateStampDutyLmi } = require('./stampDutyLmi');
const { calculateCgt } = require('./cgt');
const { calculateRefinanceBreakEven, monthlyRepayment } = require('./refinanceBreakEven');
const { calculateEarlyPayoutBreakCost } = require('./earlyPayout');

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
    console.log(`  ${err.message}`);
  }
}

function approx(a, b, tol = 0.02) {
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (tol ${tol})`);
}

// ─── Stamp duty / LMI ────────────────────────────────────────────────────────

test('NSW stamp duty hand-worked @ $800,000', () => {
  // Bracket: over 364k @ 4.5% + base 10897 → 10897 + (800000-364000)*0.045
  const expected = roundMoney(10_897 + (800_000 - 364_000) * 0.045);
  const got = dutyFromBrackets(800_000, STAMP_DUTY_TABLES.NSW.brackets);
  assert.strictEqual(got, expected);
  assert.strictEqual(got, 30_517);
});

test('VIC stamp duty hand-worked @ $700,000', () => {
  // 130k–960k: base 2870 + 6% over 130k → 2870 + 570000*0.06 = 2870 + 34200 = 37070
  const expected = roundMoney(2_870 + (700_000 - 130_000) * 0.06);
  assert.strictEqual(dutyFromBrackets(700_000, STAMP_DUTY_TABLES.VIC.brackets), expected);
  assert.strictEqual(expected, 37_070);
});

test('Buy NSW non-FHB returns duty + no LMI at 20% deposit', () => {
  const r = calculateStampDutyLmi({
    property_value: 800_000,
    state: 'NSW',
    is_first_home_buyer: false,
    deposit_amount: 160_000,
    loan: { balance: 640_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stamp_duty_payable, 30_517);
  assert.strictEqual(r.lmi_required, false);
  assert.strictEqual(r.lmi_estimate, null);
  assert.ok(r.caveats.some((c) => /confirm with the state revenue/i.test(c)));
});

test('Buy NSW FHB under full exemption threshold → $0 duty', () => {
  const r = calculateStampDutyLmi({
    property_value: 750_000,
    state: 'NSW',
    is_first_home_buyer: true,
    loan: { balance: 600_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.fhb_concession_applied, true);
  assert.strictEqual(r.stamp_duty_payable, 0);
  assert.ok(r.assumptions.some((a) => /full FHB/i.test(a)));
});

test('LMI required when LVR 90%', () => {
  const r = calculateStampDutyLmi({
    property_value: 1_000_000,
    state: 'QLD',
    is_first_home_buyer: false,
    loan: { balance: 900_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lmi_required, true);
  assert.strictEqual(r.lvr, 0.9);
  // 1.75% of 900k
  assert.strictEqual(r.lmi_estimate, 15_750);
  assert.ok(r.caveats.some((c) => /order-of-magnitude/i.test(c)));
});

test('Stamp duty errors when state missing', () => {
  const r = calculateStampDutyLmi({ property_value: 500_000, is_first_home_buyer: false });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.length > 0);
});

// GAP: exact LVR boundary (80.00%) was untested — rule is "LMI when LVR > 80%", so
// exactly 80% must NOT require LMI, while a cent over must.
test('LMI boundary: LVR exactly 80% requires no LMI', () => {
  const r = calculateStampDutyLmi({
    property_value: 1_000_000,
    state: 'NSW',
    is_first_home_buyer: false,
    loan: { balance: 800_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lvr, 0.8);
  assert.strictEqual(r.lmi_required, false);
  assert.strictEqual(r.lmi_estimate, null);
});

test('LMI boundary: LVR just above 80% requires LMI', () => {
  const r = calculateStampDutyLmi({
    property_value: 1_000_000,
    state: 'NSW',
    is_first_home_buyer: false,
    loan: { balance: 800_001 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lmi_required, true);
  assert.ok(r.lmi_estimate > 0);
});

// GAP: exact FHB full-exemption boundary was untested — NSW full exemption applies
// "≤ $800,000"; one dollar over must fall into the tapered concession instead.
test('NSW FHB boundary: exactly $800,000 gets full exemption ($0 duty)', () => {
  const r = calculateStampDutyLmi({
    property_value: 800_000,
    state: 'NSW',
    is_first_home_buyer: true,
    loan: { balance: 600_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.fhb_concession_applied, true);
  assert.strictEqual(r.stamp_duty_payable, 0);
});

test('NSW FHB boundary: $800,001 loses full exemption, gets tapered concession instead', () => {
  const r = calculateStampDutyLmi({
    property_value: 800_001,
    state: 'NSW',
    is_first_home_buyer: true,
    loan: { balance: 600_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.fhb_concession_applied, true);
  assert.ok(r.stamp_duty_payable > 0, 'expected some duty payable just above the full-exemption threshold');
  assert.ok(r.stamp_duty_payable < r.stamp_duty_standard, 'tapered concession should still reduce duty below standard');
});

// GAP: QLD FHB above $800k with NO is_ppor flag cannot claim home concession
// (occupancy unknown) — falls through to general rate. When is_ppor is true,
// home concession MUST still apply (see next tests).
test('QLD FHB above concession ceiling without is_ppor pays general rate', () => {
  const r = calculateStampDutyLmi({
    property_value: 900_000,
    state: 'QLD',
    is_first_home_buyer: true,
    loan: { balance: 700_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.fhb_concession_applied, false);
  assert.strictEqual(r.ppor_concession_applied, false);
  assert.strictEqual(r.fhb_concession_amount, 0);
  assert.strictEqual(r.stamp_duty_payable, r.stamp_duty_standard);
  assert.strictEqual(r.stamp_duty_payable, 33_525);
});

// QLD home concession — ANY PPOR owner-occupier, FHB or not. Saves up to $7,175
// vs general rate at ≥ $350k. Source: QRO published home concession rates.
test('QLD non-FHB PPOR at $900k gets home concession (−$7,175 vs general)', () => {
  const r = calculateStampDutyLmi({
    property_value: 900_000,
    state: 'QLD',
    is_first_home_buyer: false,
    is_ppor: true,
    loan: { balance: 700_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stamp_duty_standard, 33_525);
  assert.strictEqual(r.stamp_duty_payable, 26_350);
  assert.strictEqual(r.ppor_concession_applied, true);
  assert.strictEqual(r.ppor_concession_amount, 7_175);
  assert.strictEqual(r.fhb_concession_applied, false);
});

test('QLD FHB PPOR above $800k still gets home concession (does not fall to investor rate)', () => {
  const r = calculateStampDutyLmi({
    property_value: 950_000,
    state: 'QLD',
    is_first_home_buyer: true,
    is_ppor: true,
    loan: { balance: 760_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stamp_duty_standard, 35_775);
  assert.strictEqual(r.stamp_duty_payable, 28_600);
  assert.strictEqual(r.ppor_concession_applied, true);
  assert.strictEqual(r.ppor_concession_amount, 7_175);
  assert.strictEqual(r.fhb_concession_applied, false);
});

test('QLD investor (is_ppor false) at $900k pays general rate', () => {
  const r = calculateStampDutyLmi({
    property_value: 900_000,
    state: 'QLD',
    is_first_home_buyer: false,
    is_ppor: false,
    loan: { balance: 700_000 },
  });
  assert.strictEqual(r.stamp_duty_payable, 33_525);
  assert.strictEqual(r.ppor_concession_applied, false);
});

// ─── CGT ─────────────────────────────────────────────────────────────────────

test('CGT full MRE when never investment', () => {
  const r = calculateCgt({
    property_value: 1_450_000,
    purchase_price: 820_000,
    purchase_date: '2016-04-12',
    settlement_date: '2026-09-15',
    was_ever_investment_property: false,
    state: 'NSW',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.main_residence_exempt, true);
  assert.strictEqual(r.taxable_capital_gain_estimate, 0);
  assert.strictEqual(r.capital_gain_gross, 630_000);
  assert.strictEqual(r.partial_exemption_flagged, false);
});

test('CGT 50% discount when held >12 months and was investment', () => {
  const r = calculateCgt({
    property_value: 900_000,
    purchase_price: 500_000,
    purchase_date: '2018-01-01',
    settlement_date: '2026-01-01',
    was_ever_investment_property: true,
    state: 'QLD',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.capital_gain_gross, 400_000);
  assert.strictEqual(r.cgt_discount_applied, true);
  assert.strictEqual(r.taxable_capital_gain_estimate, 200_000);
  assert.strictEqual(r.partial_exemption_flagged, true);
  assert.ok(r.caveats.some((c) => /6-year rule/i.test(c)));
  assert.ok(r.caveats.some((c) => /does NOT compute a number/i.test(c)));
});

test('CGT no discount when held <12 months (investment)', () => {
  const r = calculateCgt({
    property_value: 600_000,
    purchase_price: 500_000,
    purchase_date: '2025-06-01',
    settlement_date: '2026-01-01',
    was_ever_investment_property: true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.held_over_12_months, false);
  assert.strictEqual(r.cgt_discount_applied, false);
  assert.strictEqual(r.taxable_capital_gain_estimate, 100_000);
  assert.strictEqual(r.partial_exemption_flagged, true);
});

test('CGT refuses when PPOR/investment unknown', () => {
  const r = calculateCgt({
    property_value: 600_000,
    purchase_price: 500_000,
  });
  assert.strictEqual(r.ok, false);
});

// GAP: purchase_price > sale_price (capital loss) was previously lumped in with the
// $0-gain branch and never labelled as a loss — losing the fact that capital losses can
// be carried forward to offset future gains. calculateCgt now returns is_capital_loss +
// capital_loss_amount and a caveat about carry-forward treatment.
test('CGT capital loss (sale < purchase) is negative, zero taxable, and flagged as a loss', () => {
  const r = calculateCgt({
    property_value: 450_000,
    purchase_price: 500_000,
    purchase_date: '2020-01-01',
    settlement_date: '2026-01-01',
    was_ever_investment_property: true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.capital_gain_gross, -50_000);
  assert.strictEqual(r.taxable_capital_gain_estimate, 0);
  assert.strictEqual(r.cgt_discount_applied, false);
  assert.strictEqual(r.is_capital_loss, true);
  assert.strictEqual(r.capital_loss_amount, 50_000);
  assert.ok(r.assumptions.some((a) => /capital loss of \$50,000/i.test(a)));
  assert.ok(r.caveats.some((c) => /carried\s*forward/i.test(c)));
});

// GAP: exact break-even (sale === purchase) must not be mislabelled as a loss.
test('CGT exact break-even (sale === purchase) is $0 gain, not a loss', () => {
  const r = calculateCgt({
    property_value: 500_000,
    purchase_price: 500_000,
    purchase_date: '2020-01-01',
    settlement_date: '2026-01-01',
    was_ever_investment_property: true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.capital_gain_gross, 0);
  assert.strictEqual(r.taxable_capital_gain_estimate, 0);
  assert.strictEqual(r.is_capital_loss, false);
  assert.strictEqual(r.capital_loss_amount, 0);
});

// BUG: monthsBetween only compared year/month, ignoring day-of-month. A purchase on
// 2020-01-31 sold on 2021-01-01 is only ~11 months of real ownership but the old formula
// returned exactly 12, wrongly granting the 50% CGT discount a month early.
test('CGT holding period accounts for day-of-month, not just calendar months', () => {
  const r = calculateCgt({
    property_value: 700_000,
    purchase_price: 600_000,
    purchase_date: '2020-01-31',
    settlement_date: '2021-01-01',
    was_ever_investment_property: true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.held_over_12_months, false);
  assert.strictEqual(r.cgt_discount_applied, false);
  assert.strictEqual(r.taxable_capital_gain_estimate, 100_000);
});

// Same-day-of-month one year later must still count as held >= 12 months (regression
// guard for the day-of-month fix above).
test('CGT holding period: exactly 12 months (same day-of-month) still qualifies for discount', () => {
  const r = calculateCgt({
    property_value: 700_000,
    purchase_price: 600_000,
    purchase_date: '2020-01-15',
    settlement_date: '2021-01-15',
    was_ever_investment_property: true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.held_over_12_months, true);
  assert.strictEqual(r.cgt_discount_applied, true);
  assert.strictEqual(r.taxable_capital_gain_estimate, 50_000);
});

// GAP (Round 3 focus area #4): calculateCgt only exposes a BINARY was_ever_investment_property
// switch — there is no field/path for "was PPOR for N years, then rented under the 6-year
// rule, still partially exempt". Passing hypothetical partial-occupancy detail (years as
// main residence / years rented) has NO effect on the result because cgt.js never reads
// those fields — it silently falls through to the same "ever investment = no full exemption,
// full taxable gain (minus discount)" path as a pure investment property. Lock this in so a
// future attempt to "quietly" support partial MRE without a dedicated code path doesn't
// slip through unnoticed, and confirm the caveat is SPECIFIC to the 6-year rule (tells the
// user to get tax advice for exactly this case) rather than only the generic disclaimer.
test('CGT partial main-residence (6-year rule) is NOT modelled — extra occupancy fields are ignored, specific caveat required', () => {
  const withHypotheticalPartialMreFields = calculateCgt({
    property_value: 900_000,
    purchase_price: 500_000,
    purchase_date: '2015-01-01',
    was_ever_investment_property: true,
    settlement_date: '2026-01-01',
    // These fields describe a genuine partial-MRE / 6-year-rule situation (lived in it for
    // 6 years, then rented it out under the 6-year rule for the remaining ownership period) —
    // but calculateCgt has no parameter for any of this and must ignore it entirely.
    years_as_main_residence: 6,
    years_rented_under_six_year_rule: 5,
    six_year_rule_claimed: true,
  });
  const withoutThoseFields = calculateCgt({
    property_value: 900_000,
    purchase_price: 500_000,
    purchase_date: '2015-01-01',
    was_ever_investment_property: true,
    settlement_date: '2026-01-01',
  });

  // Identical result whether or not partial-MRE detail is supplied — proves it's ignored,
  // not silently (and incorrectly) factored into a partial exemption.
  assert.strictEqual(
    withHypotheticalPartialMreFields.taxable_capital_gain_estimate,
    withoutThoseFields.taxable_capital_gain_estimate
  );
  assert.strictEqual(withHypotheticalPartialMreFields.main_residence_exempt, false);
  assert.strictEqual(withHypotheticalPartialMreFields.partial_exemption_flagged, true);

  // The caveat must be SPECIFIC to the 6-year rule / partial exemption case — not just the
  // generic "this is not tax advice, consult a tax agent" disclaimer that appears regardless.
  const genericDisclaimer = withHypotheticalPartialMreFields.caveats.find((c) => /this is not tax advice/i.test(c));
  const sixYearRuleCaveat = withHypotheticalPartialMreFields.caveats.find((c) => /6-year rule/i.test(c));
  assert.ok(genericDisclaimer, 'expected the generic tax-advice disclaimer to still be present');
  assert.ok(sixYearRuleCaveat, 'expected a caveat specifically about the 6-year rule / partial MRE');
  assert.notStrictEqual(
    sixYearRuleCaveat,
    genericDisclaimer,
    'the 6-year-rule caveat must be distinct from the generic disclaimer, not the same generic text'
  );
  assert.ok(
    /does not compute a number for that|get tax advice with occupancy dates/i.test(sixYearRuleCaveat),
    `expected the 6-year-rule caveat to explicitly tell the user this is unmodelled and needs tax advice with occupancy dates, got: ${sixYearRuleCaveat}`
  );
});

// ─── Refinance break-even ────────────────────────────────────────────────────

test('Monthly repayment hand-check', () => {
  // $500k @ 6% over 300 months
  const m = monthlyRepayment(500_000, 6, 300);
  approx(m, 3221.51, 1); // allow $1 rounding
});

test('Refinance break-even months from rate cut', () => {
  const r = calculateRefinanceBreakEven({
    property_id: 'prop_1',
    current_loan: {
      balance: 500_000,
      rate: 6.1,
      fixed_or_variable: 'variable',
      term_remaining_months: 300,
    },
    target_loan: {
      balance: 500_000,
      rate: 5.4,
      fixed_or_variable: 'variable',
      term_remaining_months: 300,
    },
  // Use explicit opts so test isn't coupled to default fee values.
  // Upfront: discharge(350) + establishment(600) + valuation(250) + legal(400) + govt(340) = 1940
  }, { discharge_fee: 350, establishment_fee: 600, valuation_fee: 250, legal_fee: 400 });
  // state not supplied → national average govt fee (340)
  const expectedUpfront = 350 + 600 + 250 + 400 + 340; // 1940

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.upfront_cost, expectedUpfront);
  assert.ok(r.monthly_saving > 0);
  assert.ok(r.break_even_months >= 1);
  // Hand: break-even = ceil(upfront / saving)
  const expectedMonths = Math.ceil(expectedUpfront / r.monthly_saving);
  assert.strictEqual(r.break_even_months, expectedMonths);
  assert.ok(r.caveats.length >= 1);
});

test('Refinance with higher target rate → no break-even', () => {
  const r = calculateRefinanceBreakEven({
    current_loan: { balance: 400_000, rate: 5.0, fixed_or_variable: 'variable', term_remaining_months: 240 },
    target_loan: { balance: 400_000, rate: 5.5, fixed_or_variable: 'variable', term_remaining_months: 240 },
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.monthly_saving < 0);
  assert.strictEqual(r.break_even_months, null);
});

// GAP: identical current/target repayment (monthlySaving === 0) was untested — must not
// divide by zero and must not silently return a misleading finite break-even.
test('Refinance with identical rate/term (monthly_saving = 0) → break_even_months null, no divide-by-zero', () => {
  const r = calculateRefinanceBreakEven({
    current_loan: { balance: 400_000, rate: 6.0, fixed_or_variable: 'variable', term_remaining_months: 300 },
    target_loan: { balance: 400_000, rate: 6.0, fixed_or_variable: 'variable', term_remaining_months: 300 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.monthly_saving, 0);
  assert.strictEqual(r.break_even_months, null);
  assert.ok(Number.isFinite(r.upfront_cost));
  assert.ok(r.caveats.some((c) => /never recovered/i.test(c)));
});

// GAP: 0-balance current loan was untested. monthlyRepayment(0, …) returns 0, so this
// must not throw or divide by zero, and should report $0 repayments both sides.
test('Refinance with 0 current balance does not throw and reports $0 repayments', () => {
  const r = calculateRefinanceBreakEven({
    current_loan: { balance: 0, rate: 6.0, fixed_or_variable: 'variable', term_remaining_months: 300 },
    target_loan: { balance: 0, rate: 5.4, fixed_or_variable: 'variable', term_remaining_months: 300 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.monthly_repayment_current, 0);
  assert.strictEqual(r.monthly_repayment_target, 0);
  assert.strictEqual(r.monthly_saving, 0);
  assert.strictEqual(r.break_even_months, null);
});

// GAP: 0% interest rate on refinance loans was untested — monthlyRepayment must fall
// back to a straight-line principal/term split instead of a NaN/Infinity factor.
test('Refinance monthlyRepayment at 0% rate = principal / term (no NaN/Infinity)', () => {
  const m = monthlyRepayment(120_000, 0, 120);
  assert.strictEqual(m, 1000);
  const r = calculateRefinanceBreakEven({
    current_loan: { balance: 120_000, rate: 0, fixed_or_variable: 'variable', term_remaining_months: 120 },
    target_loan: { balance: 120_000, rate: 0, fixed_or_variable: 'variable', term_remaining_months: 120 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.monthly_repayment_current, 1000);
  assert.strictEqual(r.monthly_repayment_target, 1000);
});

// GAP: negative rates were untested — calculateRefinanceBreakEven should refuse (errors)
// rather than silently compute a nonsensical negative-rate repayment.
test('Refinance refuses negative rates instead of computing a nonsensical result', () => {
  const r = calculateRefinanceBreakEven({
    current_loan: { balance: 400_000, rate: -1, fixed_or_variable: 'variable', term_remaining_months: 240 },
    target_loan: { balance: 400_000, rate: 5.5, fixed_or_variable: 'variable', term_remaining_months: 240 },
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /current_loan\.rate/i.test(e)));
});

// ─── Early payout ────────────────────────────────────────────────────────────

test('Fixed-rate IRD uses fixed period months — not loan term', () => {
  // $520k @ 6.1% vs 5.4%, 24 months left on fixed period, 180 months left on loan
  // 520000 * 0.007 * 2 = 7280  (NOT 54600 which wrongly used 15y loan term)
  const r = calculateEarlyPayoutBreakCost({
    property_id: 'prop_ppor',
    current_loan: {
      balance: 520_000,
      rate: 6.1,
      fixed_or_variable: 'fixed',
      term_remaining_months: 180,
      fixed_period_remaining_months: 24,
      lender: 'CityBank',
    },
    payout_date: '2026-09-01',
  }, { comparison_rate: 5.4 });

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.break_cost_estimate, 7_280);
  assert.strictEqual(r.remaining_fixed_months, 24);
  assert.strictEqual(r.loan_term_remaining_months, 180);
  assert.strictEqual(r.interest_rate_differential_pp, 0.7);
  assert.ok(r.assumptions.some((a) => /not used in the IRD formula/i.test(a)));
});

test('Fixed-rate IRD refuses when only loan term is present (no fixed period)', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 520_000,
      rate: 6.1,
      fixed_or_variable: 'fixed',
      term_remaining_months: 180,
      // deliberately no fixed_period_remaining_months
    },
  }, { comparison_rate: 5.4 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /fixed_period_remaining_months/i.test(e)));
  assert.strictEqual(r.break_cost_estimate, null);
});

test('Variable early payout → $0 IRD break cost', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 180_000,
      rate: 5.8,
      fixed_or_variable: 'variable',
      term_remaining_months: 120,
    },
  }, { comparison_rate: 5.0 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.break_cost_estimate, 0);
  assert.strictEqual(r.method, 'variable_no_ird');
});

test('Investment property flags tax deductibility question', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 300_000,
      rate: 5.9,
      fixed_or_variable: 'fixed',
      term_remaining_months: 300,
      fixed_period_remaining_months: 24,
    },
  }, { comparison_rate: 5.2, was_ever_investment_property: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tax_deductibility_flagged, true);
  assert.ok(r.caveats.some((c) => /tax professional/i.test(c)));
  // 300000 * 0.007 * 2 = 4200
  assert.strictEqual(r.break_cost_estimate, 4_200);
});

test('Early payout errors without comparison_rate on fixed', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 100_000,
      rate: 6,
      fixed_or_variable: 'fixed',
      term_remaining_months: 120,
      fixed_period_remaining_months: 12,
    },
  });
  assert.strictEqual(r.ok, false);
});

test('Does not silently use term_remaining_months via opts confusion', () => {
  // Passing only term on the loan must fail — even if someone might hope opts fall back
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 520_000,
      rate: 6.1,
      fixed_or_variable: 'fixed',
      term_remaining_months: 180,
    },
  }, { comparison_rate: 5.4 });
  assert.strictEqual(r.ok, false);
  assert.notStrictEqual(r.break_cost_estimate, 54_600);
});

// BUG (Round 2): fixed_period_remaining_months explicitly set to 0 (fixed period has
// already ended) was previously lumped into the "remainingFixed <= 0" branch and treated
// as a missing-input error — refusing to compute anything even though a fixed period
// with zero months left unambiguously means $0 IRD break cost, not an unknown input.
test('Fixed period explicitly at 0 months remaining returns $0 break cost, not an error', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 400_000,
      rate: 6.0,
      fixed_or_variable: 'fixed',
      term_remaining_months: 180,
      fixed_period_remaining_months: 0,
    },
  }, { comparison_rate: 5.0 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.break_cost_estimate, 0);
  assert.strictEqual(r.method, 'fixed_period_ended');
  assert.strictEqual(r.remaining_fixed_months, 0);
  assert.ok(r.caveats.some((c) => /already ended/i.test(c)));
});

// GAP: comparison_rate exceeding the contract rate on a fixed loan was untested at the
// standalone calculator level (only exercised indirectly via the payout-after-refinance
// fixture). Locks in that a favourable comparison rate never produces a negative "break
// cost" — IRD floors at $0.
test('Comparison rate above contract rate on fixed loan → $0 break cost (never negative)', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 400_000,
      rate: 5.0,
      fixed_or_variable: 'fixed',
      term_remaining_months: 180,
      fixed_period_remaining_months: 24,
    },
  }, { comparison_rate: 6.5 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.break_cost_estimate, 0);
  assert.ok(r.interest_rate_differential_pp < 0);
  assert.ok(r.assumptions.some((a) => /IRD economic cost estimated at \$0/i.test(a)));
});

// GAP: a $0 outstanding balance on a fixed loan was untested — the IRD formula multiplies
// by balance, so this must cleanly resolve to $0 rather than skipping/erroring.
test('Zero outstanding balance on fixed loan → $0 break cost, still ok', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 0,
      rate: 6.0,
      fixed_or_variable: 'fixed',
      term_remaining_months: 180,
      fixed_period_remaining_months: 24,
    },
  }, { comparison_rate: 5.0 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.break_cost_estimate, 0);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${B}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
process.exit(failed ? 1 : 0);
