#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  extractSpans,
  formatSpansForPrompt,
  spanMatchesCurrency,
  spanMatchesPercent,
  spanMatchesDurationMonths,
  spanMatchesDate,
} = require('./extractSpans');
const { createScenario, createLoanSnapshot } = require('./scenario');
const { groundScenarioAgainstText } = require('./grounding');
const { normalizeParsedScenario } = require('./parseScenario');

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

test('extractSpans finds currency, percent, duration with positions', () => {
  const text = 'Owing about $520k at 6.1% with 3-year fixed and 15 years left on the loan.';
  const { spans } = extractSpans(text);
  assert.ok(spans.some((s) => s.kind === 'currency' && s.value === 520000));
  assert.ok(spans.some((s) => s.kind === 'percent' && s.value === 6.1));
  assert.ok(spans.some((s) => s.kind === 'duration' && s.value_months === 36));
  assert.ok(spans.some((s) => s.kind === 'duration' && s.value_months === 180));
  const c = spans.find((s) => s.kind === 'currency' && s.value === 520000);
  assert.ok(c.start >= 0 && c.end > c.start);
  assert.ok(text.slice(c.start, c.end).includes('520'));
});

test('extractSpans resolves relative dates against asOf', () => {
  const text = 'We settle next month after exchanging in September.';
  const { spans, as_of } = extractSpans(text, { asOf: '2026-07-15' });
  assert.strictEqual(as_of, '2026-07-15');
  const dates = spans.filter((s) => s.kind === 'date');
  assert.ok(dates.length >= 1, `expected date spans, got ${JSON.stringify(spans)}`);
  assert.ok(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.resolved_iso)));
});

test('extractSpans does not invent — only substrings present', () => {
  const text = 'Selling and buying — no numbers here.';
  const { spans } = extractSpans(text);
  assert.ok(!spans.some((s) => s.kind === 'currency'));
  assert.ok(!spans.some((s) => s.kind === 'percent'));
});

test('formatSpansForPrompt lists numbered spans for assignment framing', () => {
  const pack = extractSpans('Price is $1.2 million at 5.4%.');
  const block = formatSpansForPrompt(pack);
  assert.match(block, /\[S1\]/);
  assert.match(block, /ASSIGN/i);
  assert.match(block, /Do not invent/i);
});

test('number in text stays available even if LLM assignment omits it', () => {
  const text = 'Looking at a purchase around $875,000 — still unclear which property.';
  const { spans } = extractSpans(text);
  assert.ok(spanMatchesCurrency(spans, 875000));
  // Simulated LLM that failed to assign the purchase price
  const scenario = createScenario({
    id: 'sc_missed_assign',
    events: [{
      id: 'ev_buy',
      type: 'buy',
      sequence: 1,
      fields: { property_id: 'prop_new' },
    }],
  });
  groundScenarioAgainstText(scenario, text, { spans });
  assert.strictEqual(scenario.events[0].fields.property_value, undefined);
  // Span pack still holds the literal for callers / later clarify
  assert.ok(spans.some((s) => s.kind === 'currency' && s.value === 875000));
});

test('LLM-invented amount with no matching span is stripped', () => {
  const text = 'I am selling our place and buying a new one. Rates are around 6%.';
  const { spans } = extractSpans(text);
  assert.ok(spanMatchesPercent(spans, 6));
  assert.ok(!spanMatchesCurrency(spans, 950000));

  const scenario = normalizeParsedScenario({
    scenario: {
      id: 'sc_invent',
      starting_properties: [{ id: 'prop_1' }],
      events: [{
        id: 'ev_1',
        type: 'sell',
        sequence: 1,
        fields: {
          property_id: 'prop_1',
          property_value: 950000, // invented — not in text
        },
      }],
      unresolved_assumptions: [],
    },
  });

  const { stripped } = groundScenarioAgainstText(scenario, text, { spans });
  assert.ok(stripped.includes('events[0].fields.property_value'), `stripped=${stripped}`);
  assert.strictEqual(scenario.events[0].fields.property_value, undefined);
  assert.ok(scenario.unresolved_assumptions.some((a) => /property value|950/i.test(a.message)));
});

test('LLM-invented rate with no percent span is stripped; grounded rate kept', () => {
  const text = 'Variable loan currently at 5.49% against our home.';
  const { spans } = extractSpans(text);
  const scenario = createScenario({
    id: 'sc_rate',
    starting_properties: [{
      id: 'prop_1',
      current_loan: createLoanSnapshot({
        balance: 100000, // also inventsed — will strip
        rate: 5.49,
        fixed_or_variable: 'variable',
        term_remaining_months: 120, // inventsed months — will strip
      }),
    }],
    events: [],
  });
  groundScenarioAgainstText(scenario, text, { spans });
  const loan = scenario.starting_properties[0].current_loan;
  assert.strictEqual(loan.rate, 5.49);
  assert.strictEqual(loan.balance, undefined);
  assert.strictEqual(loan.term_remaining_months, undefined);
});

test('span matchers recognise million / k forms', () => {
  const { spans } = extractSpans('Budget is 1.45 million or maybe 650k.');
  assert.ok(spanMatchesCurrency(spans, 1_450_000));
  assert.ok(spanMatchesCurrency(spans, 650_000));
});

console.log(`\n${B}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
process.exit(failed ? 1 : 0);
