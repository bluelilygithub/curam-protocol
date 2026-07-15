#!/usr/bin/env node
/**
 * Grounding unit tests + Case 3 multi-run hallucination probe.
 *
 * Unit (no API): node server/services/propertyScenario/grounding.test.js
 * Live Case 3×N:  CASE3_RUNS=8 node server/services/propertyScenario/grounding.test.js --live
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const assert = require('assert');
const {
  groundScenarioAgainstText,
  findUngroundedCriticalFields,
} = require('./grounding');
const { createScenario } = require('./scenario');
const { normalizeParsedScenario } = require('./parseScenario');

const G = '\x1b[32m';
const R = '\x1b[31m';
const Y = '\x1b[33m';
const B = '\x1b[1m';
const X = '\x1b[0m';

const CASE3 = "I'm selling and buying. Selling our place and buying a new one.";

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

test('strips invented NSW + PPOR from sparse sell/buy text', () => {
  const scenario = normalizeParsedScenario({
    scenario: {
      id: 'sc_halluc',
      starting_properties: [{
        id: 'prop_1',
        state: 'NSW',
        was_ever_investment_property: false,
      }],
      events: [
        {
          id: 'ev_1',
          type: 'sell',
          sequence: 1,
          fields: {
            property_id: 'prop_1',
            state: 'NSW',
            was_ever_investment_property: false,
          },
        },
        {
          id: 'ev_2',
          type: 'buy',
          sequence: 2,
          fields: {
            property_id: 'prop_2',
            state: 'NSW',
            is_first_home_buyer: false,
          },
        },
      ],
      unresolved_assumptions: [],
    },
  });

  const { stripped } = groundScenarioAgainstText(scenario, CASE3);
  assert.ok(stripped.some((p) => p.includes('state')), `expected state stripped, got ${stripped}`);
  assert.ok(stripped.some((p) => p.includes('was_ever_investment_property')));
  assert.ok(stripped.some((p) => p.includes('is_first_home_buyer')));
  assert.strictEqual(scenario.starting_properties[0].state, undefined);
  assert.strictEqual(scenario.events[0].fields.was_ever_investment_property, undefined);
  assert.strictEqual(scenario.events[1].fields.is_first_home_buyer, undefined);
  assert.ok(scenario.unresolved_assumptions.some((a) => /state/i.test(a.message)));
  assert.ok(scenario.unresolved_assumptions.some((a) => /PPOR|investment/i.test(a.message)));
  assert.deepStrictEqual(findUngroundedCriticalFields(scenario, CASE3), []);
});

test('keeps NSW when Marrickville (NSW suburb) is in text', () => {
  const text = 'Selling my Marrickville home that was never an investment property.';
  const scenario = createScenario({
    id: 'sc_ok',
    starting_properties: [{
      id: 'prop_1',
      state: 'NSW',
      was_ever_investment_property: false,
    }],
    events: [{
      id: 'ev_1',
      type: 'sell',
      sequence: 1,
      fields: { property_id: 'prop_1', state: 'NSW', was_ever_investment_property: false },
    }],
  });
  const { stripped } = groundScenarioAgainstText(scenario, text);
  assert.deepStrictEqual(stripped, []);
  assert.strictEqual(scenario.starting_properties[0].state, 'NSW');
  assert.strictEqual(scenario.events[0].fields.was_ever_investment_property, false);
});

test('strips wrong state even when another state is mentioned', () => {
  const text = 'Buying in Victoria after selling.';
  const scenario = createScenario({
    id: 'sc_wrong',
    starting_properties: [],
    events: [{
      id: 'ev_1',
      type: 'buy',
      sequence: 1,
      fields: { property_id: 'prop_2', state: 'NSW', is_first_home_buyer: true },
    }],
  });
  const { stripped } = groundScenarioAgainstText(scenario, text);
  assert.ok(stripped.includes('events[0].fields.state'));
  assert.ok(stripped.includes('events[0].fields.is_first_home_buyer'));
  assert.strictEqual(scenario.events[0].fields.state, undefined);
});

test('fixed-only text: equal months conflation keeps fixed period, strips loan term', () => {
  const text = 'I want to pay out my $520k mortgage early. It is 3-year fixed at 6.1%.';
  const scenario = normalizeParsedScenario({
    scenario: {
      id: 'sc_fixed_only',
      starting_properties: [{
        id: 'prop_1',
        current_loan: {
          balance: 520000,
          rate: 6.1,
          fixed_or_variable: 'fixed',
          // Model copied 36 into both — the bug we must catch
          term_remaining_months: 36,
          fixed_period_remaining_months: 36,
        },
      }],
      events: [{
        id: 'ev_1',
        type: 'early_payout',
        sequence: 1,
        fields: {
          property_id: 'prop_1',
          current_loan: {
            balance: 520000,
            rate: 6.1,
            fixed_or_variable: 'fixed',
            term_remaining_months: 36,
            fixed_period_remaining_months: 36,
          },
        },
      }],
      unresolved_assumptions: [],
    },
  });

  const { stripped } = groundScenarioAgainstText(scenario, text);
  const startLoan = scenario.starting_properties[0].current_loan;
  const eventLoan = scenario.events[0].fields.current_loan;

  assert.ok(stripped.some((p) => p.endsWith('term_remaining_months')), `expected term stripped, got ${stripped}`);
  assert.strictEqual(startLoan.fixed_period_remaining_months, 36);
  assert.strictEqual(startLoan.term_remaining_months, undefined);
  assert.strictEqual(eventLoan.fixed_period_remaining_months, 36);
  assert.strictEqual(eventLoan.term_remaining_months, undefined);
  assert.ok(
    scenario.unresolved_assumptions.some((a) => /overall loan term|amortisation/i.test(a.message)),
    `expected loan-term assumption, got ${JSON.stringify(scenario.unresolved_assumptions)}`
  );
  assert.deepStrictEqual(findUngroundedCriticalFields(scenario, text), []);
});

test('loan-term-only text: equal months conflation keeps term, strips fixed period', () => {
  const text = 'Refinancing my home loan — about $400k left with 15 years left on the loan.';
  const scenario = normalizeParsedScenario({
    scenario: {
      id: 'sc_term_only',
      starting_properties: [{
        id: 'prop_1',
        current_loan: {
          balance: 400000,
          rate: 5.5,
          fixed_or_variable: 'fixed',
          term_remaining_months: 180,
          fixed_period_remaining_months: 180, // invented copy
        },
      }],
      events: [{
        id: 'ev_1',
        type: 'refinance',
        sequence: 1,
        fields: {
          property_id: 'prop_1',
          current_loan: {
            balance: 400000,
            rate: 5.5,
            fixed_or_variable: 'fixed',
            term_remaining_months: 180,
            fixed_period_remaining_months: 180,
          },
          target_loan: {
            balance: 400000,
            rate: 4.9,
            fixed_or_variable: 'variable',
            term_remaining_months: 180,
          },
        },
      }],
      unresolved_assumptions: [],
    },
  });

  groundScenarioAgainstText(scenario, text);
  const startLoan = scenario.starting_properties[0].current_loan;
  const cur = scenario.events[0].fields.current_loan;

  assert.strictEqual(startLoan.term_remaining_months, 180);
  assert.strictEqual(startLoan.fixed_period_remaining_months, undefined);
  assert.strictEqual(cur.term_remaining_months, 180);
  assert.strictEqual(cur.fixed_period_remaining_months, undefined);
  assert.ok(
    scenario.unresolved_assumptions.some((a) => /fixed-rate period/i.test(a.message)),
    `expected fixed-period assumption, got ${JSON.stringify(scenario.unresolved_assumptions)}`
  );
  assert.deepStrictEqual(findUngroundedCriticalFields(scenario, text), []);
});

test('normalizeLoan does not copy term_remaining into fixed_period', () => {
  const scenario = normalizeParsedScenario({
    scenario: {
      id: 'sc_no_copy',
      starting_properties: [{
        id: 'prop_1',
        current_loan: {
          balance: 100000,
          rate: 5,
          fixed_or_variable: 'fixed',
          term_remaining_months: 240,
          // no fixed_period_remaining_months
        },
      }],
      events: [],
      unresolved_assumptions: [],
    },
  });
  const loan = scenario.starting_properties[0].current_loan;
  assert.strictEqual(loan.term_remaining_months, 240);
  assert.strictEqual(loan.fixed_period_remaining_months, undefined);
});

test('fixed named without remaining months → unresolved fixed-period assumption', () => {
  const text = 'Paying out my fixed home loan early.';
  const scenario = normalizeParsedScenario({
    scenario: {
      id: 'sc_fixed_missing',
      starting_properties: [{
        id: 'prop_1',
        current_loan: {
          balance: 200000,
          rate: 6,
          fixed_or_variable: 'fixed',
          term_remaining_months: 200, // ungrounded → stripped
        },
      }],
      events: [{
        id: 'ev_1',
        type: 'early_payout',
        sequence: 1,
        fields: {
          property_id: 'prop_1',
          current_loan: {
            balance: 200000,
            rate: 6,
            fixed_or_variable: 'fixed',
          },
        },
      }],
      unresolved_assumptions: [],
    },
  });
  groundScenarioAgainstText(scenario, text);
  assert.strictEqual(scenario.starting_properties[0].current_loan.term_remaining_months, undefined);
  assert.ok(
    scenario.unresolved_assumptions.some((a) => /fixed-rate period/i.test(a.message)),
    `expected fixed-period question, got ${JSON.stringify(scenario.unresolved_assumptions)}`
  );
});

test('LLM-invented property_value with no currency span is stripped (Stage 9)', () => {
  const text = 'Selling and buying — need a valuation later.';
  const scenario = normalizeParsedScenario({
    scenario: {
      id: 'sc_span_invent',
      starting_properties: [{ id: 'prop_1' }],
      events: [{
        id: 'ev_1',
        type: 'sell',
        sequence: 1,
        fields: { property_id: 'prop_1', property_value: 1_250_000 },
      }],
      unresolved_assumptions: [],
    },
  });
  const { stripped } = groundScenarioAgainstText(scenario, text);
  assert.ok(stripped.includes('events[0].fields.property_value'));
  assert.strictEqual(scenario.events[0].fields.property_value, undefined);
});

test('grounded currency/percent from spans survive when text supports them', () => {
  const text = 'Sale price $820,000 and our rate is 5.4%.';
  const scenario = normalizeParsedScenario({
    scenario: {
      id: 'sc_span_ok',
      starting_properties: [{
        id: 'prop_1',
        current_loan: { balance: 400000, rate: 5.4, fixed_or_variable: 'variable' },
      }],
      events: [{
        id: 'ev_1',
        type: 'sell',
        sequence: 1,
        fields: { property_id: 'prop_1', property_value: 820000 },
      }],
      unresolved_assumptions: [],
    },
  });
  // Note: balance 400000 is inventsed — stripped; rate + sale price kept
  const { stripped } = groundScenarioAgainstText(scenario, text);
  assert.strictEqual(scenario.events[0].fields.property_value, 820000);
  assert.strictEqual(scenario.starting_properties[0].current_loan.rate, 5.4);
  assert.strictEqual(scenario.starting_properties[0].current_loan.balance, undefined);
  assert.ok(stripped.some((p) => p.includes('balance')));
});

test('rate-type "fixed" alone does not ground fixed_period_remaining', () => {
  const {
    textGroundsFixedPeriodRemaining,
    textGroundsLoanTermRemaining,
  } = require('./grounding');
  const text = '15 years left on the loan at 5.5% fixed.';
  assert.strictEqual(textGroundsLoanTermRemaining(text), true);
  assert.strictEqual(textGroundsFixedPeriodRemaining(text), false);
  assert.strictEqual(textGroundsFixedPeriodRemaining('3-year fixed at 6.1%'), true);
});

async function runLoanConflationLive() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`${Y}Skipping live loan-conflation probe — no ANTHROPIC_API_KEY${X}`);
    return;
  }
  const { parseScenario } = require('./parseScenario');
  const {
    textGroundsFixedPeriodRemaining,
    textGroundsLoanTermRemaining,
  } = require('./grounding');

  const cases = [
    {
      id: 'fixed-only',
      text: 'I want to pay out my $520k mortgage early. It is 3-year fixed at 6.1%.',
      expectFixedGrounded: true,
      expectTermGrounded: false,
    },
    {
      id: 'term-only',
      text: 'Refinancing my home loan — about $400k left with 15 years left on the loan, currently fixed at 5.5%.',
      expectFixedGrounded: false,
      expectTermGrounded: true,
    },
  ];

  console.log(`\n${B}Live loan term vs fixed-period conflation probe${X}`);
  let fail = 0;

  for (const c of cases) {
    assert.strictEqual(textGroundsFixedPeriodRemaining(c.text), c.expectFixedGrounded);
    assert.strictEqual(textGroundsLoanTermRemaining(c.text), c.expectTermGrounded);

    process.stdout.write(`  ${c.id}… `);
    const result = await parseScenario(c.text);
    const residual = findUngroundedCriticalFields(result.scenario, c.text);
    const loans = [];
    (result.scenario.starting_properties || []).forEach((p) => {
      if (p.current_loan) loans.push(p.current_loan);
    });
    (result.scenario.events || []).forEach((e) => {
      const f = e.fields || {};
      if (f.current_loan) loans.push(f.current_loan);
      if (f.target_loan) loans.push(f.target_loan);
      if (f.loan) loans.push(f.loan);
    });

    const equalCopy = loans.filter(
      (l) => l.term_remaining_months != null
        && l.fixed_period_remaining_months != null
        && Number(l.term_remaining_months) === Number(l.fixed_period_remaining_months)
    );
    const assumptions = result.scenario.unresolved_assumptions || [];
    const askedTerm = assumptions.some((a) => /overall loan term|amortisation|loan term/i.test(a.message));
    const askedFixed = assumptions.some((a) => /fixed-rate period|fixed period/i.test(a.message));

    let ok = residual.length === 0 && equalCopy.length === 0;
    if (c.expectFixedGrounded && !c.expectTermGrounded) {
      // Must not invent overall term silently; if missing must ask
      const anyUngroundedTerm = loans.some((l) => l.term_remaining_months != null);
      ok = ok && !anyUngroundedTerm;
      ok = ok && (askedTerm || loans.every((l) => l.term_remaining_months == null));
    }
    if (c.expectTermGrounded && !c.expectFixedGrounded) {
      const anyUngroundedFixed = loans.some((l) => l.fixed_period_remaining_months != null);
      ok = ok && !anyUngroundedFixed;
      // fixed loans should ask for fixed period
      const hasFixedLoan = loans.some((l) => l.fixed_or_variable === 'fixed');
      if (hasFixedLoan) ok = ok && askedFixed;
    }

    if (ok) {
      console.log(
        `${G}ok${X} loans=${loans.length} stripped=${(result.grounding_stripped || []).length} `
        + `askedTerm=${askedTerm} askedFixed=${askedFixed}`
      );
    } else {
      fail += 1;
      console.log(`${R}FAIL${X}`);
      console.log(`    residual=${JSON.stringify(residual)}`);
      console.log(`    equalCopy=${equalCopy.length}`);
      console.log(`    loans=${JSON.stringify(loans)}`);
      console.log(`    assumptions=${assumptions.map((a) => a.message).join(' | ')}`);
    }
  }

  if (fail) {
    console.log(`${R}Live loan conflation probe: ${fail} failed${X}`);
    process.exitCode = 1;
  } else {
    console.log(`${G}Live loan conflation probe: PASS${X}`);
  }
}

async function runCase3Live(times) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`${Y}Skipping live Case 3 probe — no ANTHROPIC_API_KEY${X}`);
    return;
  }
  const { parseScenario } = require('./parseScenario');
  console.log(`\n${B}Case 3 live probe × ${times}${X}`);
  console.log(`${DIM_SAFE()}Input: ${CASE3}`);

  let modelHallucinated = 0;
  let residualUngrounded = 0;
  let strippedTotal = 0;

  for (let i = 1; i <= times; i += 1) {
    process.stdout.write(`  run ${i}/${times}… `);
    try {
      const result = await parseScenario(CASE3);
      const residual = findUngroundedCriticalFields(result.scenario, CASE3);
      const stripped = result.grounding_stripped || [];
      strippedTotal += stripped.length;
      if (stripped.length) modelHallucinated += 1;
      if (residual.length) residualUngrounded += 1;

      const statePresent = [
        ...(result.scenario.starting_properties || []).map((p) => p.state),
        ...(result.scenario.events || []).map((e) => e.fields?.state),
      ].filter(Boolean);
      const pporPresent = [
        ...(result.scenario.starting_properties || []).map((p) => p.was_ever_investment_property),
        ...(result.scenario.events || []).map((e) => e.fields?.was_ever_investment_property),
      ].filter((v) => typeof v === 'boolean');

      console.log(
        `stripped=${stripped.length} residual=${residual.length} `
        + `states=[${statePresent.join(',')}] ppor=[${pporPresent.join(',')}] `
        + `qs=${result.clarifying_questions.length}`
      );
    } catch (err) {
      residualUngrounded += 1;
      console.log(`${R}FAIL ${err.message}${X}`);
    }
  }

  console.log(`\n${B}Case 3 probe summary${X}`);
  console.log(`  Runs: ${times}`);
  console.log(`  Model invented grounded-critical fields (caught by stripper): ${modelHallucinated}/${times}`);
  console.log(`  Residual ungrounded after stripper: ${residualUngrounded}/${times}`);
  console.log(`  Total fields stripped: ${strippedTotal}`);
  if (residualUngrounded > 0) {
    console.log(`${R}  FAIL: stripper let ungrounded critical fields through${X}`);
    process.exitCode = 1;
  } else {
    console.log(`${G}  PASS: no ungrounded state/PPOR/FHB remained after grounding${X}`);
  }
}

function DIM_SAFE() {
  return '\x1b[2m';
}

async function main() {
  console.log(`${B}Grounding unit tests${X}`);
  // tests already ran via test() above

  console.log(`\n${passed} passed, ${failed} failed (unit)`);
  if (failed) process.exit(1);

  if (process.argv.includes('--live')) {
    const times = Math.max(1, Number(process.env.CASE3_RUNS) || 8);
    await runLoanConflationLive();
    await runCase3Live(times);
  } else {
    console.log(`\n${Y}Tip:${X} CASE3_RUNS=8 node server/services/propertyScenario/grounding.test.js --live`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
