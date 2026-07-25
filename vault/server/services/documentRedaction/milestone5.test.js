'use strict';

/**
 * Milestone 5 smoke — payload leak guard + frontier response parse.
 * Run: node server/services/documentRedaction/milestone5.test.js
 */

const assert = require('assert');
const { assertNoRealEntitiesInOutgoingPayload } = require('./frontierPayloadGuard');
const { parseFrontierJson } = require('./frontierParse');

function testLeakGuard() {
  const map = {
    entries: [
      { realValue: 'Jane Smith', syntheticValue: 'Alex Morgan', categoryLabel: 'person_name' },
      { realValue: '$12,400', syntheticValue: '$10,788', categoryLabel: 'financial_figure' },
    ],
  };

  assertNoRealEntitiesInOutgoingPayload(
    ['Analyze this sanitized doc about Alex Morgan and $10,788.'],
    map,
  );

  let blocked = false;
  try {
    assertNoRealEntitiesInOutgoingPayload(
      ['Still mentions Jane Smith somehow'],
      map,
    );
  } catch (err) {
    blocked = true;
    assert.strictEqual(err.code, 'ENTITY_LEAK_IN_PAYLOAD');
    assert.ok(err.hits?.length >= 1);
    assert.ok(!JSON.stringify(err.hits).includes('Jane Smith'));
  }
  assert.ok(blocked, 'must reject payload containing real entity');
}

function testParse() {
  const parsed = parseFrontierJson(`\`\`\`json
{
  "analysis": "Looks mostly safe.",
  "suggestions": [
    {
      "entityText": "unique role title",
      "categoryLabel": "role_inference",
      "confidence": 0.7,
      "rationale": "Role + timeframe may identify",
      "suggestedReplacement": "Senior Analyst"
    }
  ]
}
\`\`\``);
  assert.ok(parsed.analysis.includes('safe'));
  assert.strictEqual(parsed.suggestions.length, 1);
  assert.strictEqual(parsed.suggestions[0].categoryLabel, 'role_inference');
}

function run() {
  testLeakGuard();
  testParse();
  console.log('OK milestone5 tests');
}

run();
