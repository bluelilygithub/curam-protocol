#!/usr/bin/env node
/**
 * Property Scenario model — Stage 1 unit tests (no calculations).
 * Run: node server/services/propertyScenario/scenario.test.js
 */
'use strict';

const assert = require('assert');
const { createScenario, createLoanSnapshot, orderedEvents } = require('./scenario');
const { validateScenario, assertValidScenario } = require('./validate');
const {
  scenarioSellBuySwitchValid,
  scenarioRefinanceThenPayout,
  scenarioSellUnknownProperty,
  scenarioSellBuySwitch,
  GROUND_TRUTH_CASES,
  NEGATIVE_CASES,
  SOURCE_TEXT_SELL_BUY_SWITCH,
  SOURCE_TEXT_REFI_PAYOUT,
} = require('./fixtures');

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

// ─── Structure ───────────────────────────────────────────────────────────────

test('createScenario fills defaults', () => {
  const s = createScenario({ id: 'x' });
  assert.strictEqual(s.id, 'x');
  assert.strictEqual(s.currency, 'AUD');
  assert.deepStrictEqual(s.starting_properties, []);
  assert.deepStrictEqual(s.events, []);
  assert.deepStrictEqual(s.dependencies, []);
  assert.deepStrictEqual(s.timeline.gaps, []);
  assert.deepStrictEqual(s.unresolved_assumptions, []);
});

test('createLoanSnapshot preserves core fields', () => {
  const loan = createLoanSnapshot({
    balance: 100,
    rate: 5,
    fixed_or_variable: 'fixed',
    term_remaining_months: 12,
    lender: 'A',
  });
  assert.strictEqual(loan.balance, 100);
  assert.strictEqual(loan.fixed_or_variable, 'fixed');
  assert.strictEqual(loan.lender, 'A');
});

// ─── Compound scenario A: sell → buy → switch lender ─────────────────────────

test('Scenario A (sell→buy→switch) validates', () => {
  const s = scenarioSellBuySwitchValid();
  const result = validateScenario(s);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.strictEqual(s.events.length, 3);
  assert.strictEqual(s.dependencies.length, 1);
  assert.strictEqual(s.dependencies[0].kind, 'funds_deposit');
});

test('Scenario A events order by sequence', () => {
  const s = scenarioSellBuySwitchValid();
  // Shuffle input order; orderedEvents must still sort
  s.events = [s.events[2], s.events[0], s.events[1]];
  const ordered = orderedEvents(s);
  assert.deepStrictEqual(ordered.map((e) => e.type), ['sell', 'buy', 'switch_lender']);
});

test('Scenario A dependency links sale proceeds to deposit', () => {
  const s = scenarioSellBuySwitchValid();
  const dep = s.dependencies[0];
  assert.strictEqual(dep.from_event_id, 'ev_sell_home');
  assert.strictEqual(dep.to_event_id, 'ev_buy_new');
  assert.ok(s.timeline.gaps.length === 1);
  assert.ok(s.unresolved_assumptions.some((a) => a.field_path.includes('selling_costs')));
});

test('Scenario A assertValidScenario returns scenario', () => {
  const s = assertValidScenario(scenarioSellBuySwitchValid());
  assert.strictEqual(s.id, 'sc_sell_buy_switch');
});

// ─── Compound scenario B: refinance → early payout ───────────────────────────

test('Scenario B (refinance→early_payout) validates with two properties', () => {
  const s = scenarioRefinanceThenPayout();
  const result = validateScenario(s);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.strictEqual(s.starting_properties.length, 2);
  assert.deepStrictEqual(s.events.map((e) => e.type), ['refinance', 'early_payout']);
  assert.ok(s.unresolved_assumptions.some((a) => a.severity === 'required'));
});

test('Scenario B early payout requires owned property from starting set', () => {
  const s = scenarioRefinanceThenPayout();
  s.events[1].fields.property_id = 'prop_missing';
  const result = validateScenario(s);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'payout_unknown_property'));
});

// ─── Compound scenario C: invalid sell ───────────────────────────────────────

test('Scenario C rejects sell of unknown property', () => {
  const s = scenarioSellUnknownProperty();
  const result = validateScenario(s);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'sell_unknown_property'));
});

// ─── Validation rules ────────────────────────────────────────────────────────

test('Rejects duplicate event sequences', () => {
  const s = scenarioSellBuySwitchValid();
  s.events[1].sequence = 1;
  const result = validateScenario(s);
  assert.ok(result.errors.some((e) => e.code === 'event_sequence_dup'));
});

test('Rejects dependency that points backward in time', () => {
  const s = scenarioSellBuySwitchValid();
  s.dependencies.push({
    id: 'dep_backwards',
    from_event_id: 'ev_buy_new',
    to_event_id: 'ev_sell_home',
    kind: 'other',
  });
  const result = validateScenario(s);
  assert.ok(result.errors.some((e) => e.code === 'dep_order'));
});

test('Rejects self-referencing dependency via sequence check', () => {
  const s = scenarioSellBuySwitch(); // includes intentional self-link
  const result = validateScenario(s);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'dep_order'));
});

test('Rejects buy that reuses an existing property id', () => {
  const s = scenarioSellBuySwitchValid();
  s.events[1].fields.property_id = 'prop_current_home'; // still owned until sell applies — but sell is seq 1
  // After sell, prop_current_home is gone. Use starting id on a buy-first scenario:
  const bad = createScenario({
    id: 'dup',
    starting_properties: [{ id: 'prop_a', state: 'NSW' }],
    events: [{
      id: 'ev_buy',
      type: 'buy',
      sequence: 1,
      fields: {
        property_id: 'prop_a',
        property_value: 100,
        state: 'NSW',
        is_first_home_buyer: false,
      },
    }],
  });
  const result = validateScenario(bad);
  assert.ok(result.errors.some((e) => e.code === 'buy_duplicate_property'));
});

test('Rejects refinance on property already sold', () => {
  const s = scenarioSellBuySwitchValid();
  s.events.push({
    id: 'ev_refi_sold',
    type: 'refinance',
    sequence: 4,
    fields: {
      property_id: 'prop_current_home',
      current_loan: createLoanSnapshot({
        balance: 1, rate: 1, fixed_or_variable: 'variable', term_remaining_months: 1,
      }),
      target_loan: createLoanSnapshot({
        balance: 1, rate: 1, fixed_or_variable: 'variable', term_remaining_months: 1,
      }),
    },
  });
  const result = validateScenario(s);
  assert.ok(result.errors.some((e) => e.code === 'refinance_unknown_property'));
});

test('Unknown event type is rejected', () => {
  const s = createScenario({
    id: 'bad_type',
    events: [{ id: 'e1', type: 'gift_house', sequence: 1, fields: {} }],
  });
  const result = validateScenario(s);
  assert.ok(result.errors.some((e) => e.code === 'event_type'));
});

test('assertValidScenario throws with validation payload', () => {
  let threw = false;
  try {
    assertValidScenario(scenarioSellUnknownProperty());
  } catch (err) {
    threw = true;
    assert.ok(err.validation);
    assert.strictEqual(err.validation.ok, false);
  }
  assert.ok(threw);
});

// ─── Stage 2 ground-truth pairs ──────────────────────────────────────────────

test('GROUND_TRUTH_CASES expose source_text ↔ expected pairs', () => {
  assert.strictEqual(GROUND_TRUTH_CASES.length, 2);
  for (const gt of GROUND_TRUTH_CASES) {
    assert.ok(gt.source_text && gt.source_text.length > 80, `${gt.id} missing source_text`);
    assert.ok(gt.expected && gt.expected.id, `${gt.id} missing expected scenario`);
    assert.strictEqual(gt.kind, 'success');
    const result = validateScenario(gt.expected);
    assert.strictEqual(result.ok, true, `${gt.id}: ${JSON.stringify(result.errors)}`);
  }
});

test('Ground truth A source_text mentions Maple St and OnlineBank', () => {
  assert.ok(SOURCE_TEXT_SELL_BUY_SWITCH.includes('Maple St'));
  assert.ok(SOURCE_TEXT_SELL_BUY_SWITCH.includes('OnlineBank'));
  assert.ok(SOURCE_TEXT_SELL_BUY_SWITCH.includes('650,000') || SOURCE_TEXT_SELL_BUY_SWITCH.includes('$650,000'));
  assert.strictEqual(GROUND_TRUTH_CASES[0].expected.id, 'sc_sell_buy_switch');
});

test('Ground truth B source_text leaves break costs unstated', () => {
  assert.ok(SOURCE_TEXT_REFI_PAYOUT.includes('investment unit'));
  assert.ok(!/break cost/i.test(SOURCE_TEXT_REFI_PAYOUT));
  assert.ok(
    GROUND_TRUTH_CASES[1].expected.unresolved_assumptions.some((a) => a.id === 'ass_break_costs')
  );
});

test('NEGATIVE_CASES include sell-unknown with matching source_text', () => {
  assert.ok(NEGATIVE_CASES.length >= 1);
  const neg = NEGATIVE_CASES[0];
  assert.ok(neg.source_text.length > 40);
  assert.strictEqual(neg.kind, 'validation_error');
  assert.strictEqual(validateScenario(neg.expected).ok, false);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${B}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
process.exit(failed ? 1 : 0);
