'use strict';

/**
 * Substitution strategies + arithmetic constraint.
 * Run: node server/services/documentRedaction/substitution/substitution.test.js
 */

const assert = require('assert');
const {
  generateSubstitutions,
  listStrategies,
  UI_STYLE_TO_TARGET,
  REQUIREMENTS,
  RELATIONSHIP_ID,
  resolveSubstitutionPlan,
} = require('./index');
const { parseMoney } = require('./arithmeticConsistency');

function ents(list) {
  return list.map((e) => ({ userLocked: false, seedReplacement: '', ...e }));
}

async function testBlackoutNoFabrication() {
  const entities = ents([
    { entityKey: 'k1', realValue: '$1,173,624', categoryLabel: 'Capacity amount' },
    { entityKey: 'k2', realValue: 'Jane Smith', categoryLabel: 'Person name' },
    { entityKey: 'k3', realValue: '5.29%', categoryLabel: 'Interest rate' },
  ]);
  const result = await generateSubstitutions({
    entities,
    target: { consumer: 'legal-disclosure', requirement: REQUIREMENTS.MUST_BE_UNAMBIGUOUSLY_WITHHELD },
  });
  assert.strictEqual(result.plan.strategyId, 'blackout');
  for (const e of entities) {
    const syn = result.map.get(e.entityKey);
    assert.ok(syn, `missing ${e.entityKey}`);
    assert.ok(/^\[REDACTED_/.test(syn), `blackout must be token, got ${syn}`);
    assert.notStrictEqual(syn, e.realValue);
    // No fabricated currency/name
    assert.ok(!/^\$\d/.test(syn), 'blackout must not fabricate dollar amounts');
  }
  assert.strictEqual(result.strategyMeta.fabricatedValues, false);
  assert.ok(result.arithmetic.satisfiedByConstruction || result.arithmetic.skippedReason);
  return { strategyId: result.plan.strategyId, samples: [...result.map.values()] };
}

async function testRealisticPlausible() {
  const entities = ents([
    { entityKey: 'p1', realValue: 'Jane Smith', categoryLabel: 'Person name' },
    { entityKey: 'a1', realValue: '$12,400', categoryLabel: 'Financial figure' },
  ]);
  const result = await generateSubstitutions({
    entities,
    modelId: null, // force heuristic path — no LLM
    target: UI_STYLE_TO_TARGET.Realistic,
  });
  assert.strictEqual(result.plan.strategyId, 'realistic');
  const person = result.map.get('p1');
  const amount = result.map.get('a1');
  assert.ok(person && person !== 'Jane Smith');
  assert.ok(!/^\[REDACTED/.test(person), 'realistic must not blackout');
  assert.ok(amount && amount.startsWith('$') && amount !== '$12,400');
  assert.ok(!/[–-]/.test(amount) || !/M–/.test(amount), 'realistic should be specific not a million-band');
  assert.strictEqual(result.strategyMeta.fabricatedValues, true);
  return { person, amount };
}

async function testGeneralizedBuckets() {
  const entities = ents([
    { entityKey: 'c1', realValue: '$1,173,624', categoryLabel: 'Capacity amount' },
    { entityKey: 'b1', realValue: 'Macquarie Bank', categoryLabel: 'Bank name' },
    { entityKey: 'r1', realValue: '5.29%', categoryLabel: 'Interest rate' },
  ]);
  const result = await generateSubstitutions({
    entities,
    target: UI_STYLE_TO_TARGET.Generalized,
  });
  assert.strictEqual(result.plan.strategyId, 'generalized');
  const cap = result.map.get('c1');
  const bank = result.map.get('b1');
  const rate = result.map.get('r1');
  assert.ok(/M–|–|under \$|\$\d/.test(cap) && /–|under/.test(cap), `expected range bucket, got ${cap}`);
  assert.notStrictEqual(cap, '$1,173,624');
  assert.ok(!/^\$1,173,624$/.test(cap), 'must not keep exact value');
  // Must not be a single fabricated precise amount like $1,020,853
  assert.ok(/–|under|band|Major|\[/.test(cap) || /M/.test(cap), `bucket-like: ${cap}`);
  assert.strictEqual(bank, 'Major Bank');
  assert.ok(/%–|band/.test(rate), `rate band expected, got ${rate}`);
  assert.strictEqual(result.strategyMeta.fabricatedValues, false);
  assert.strictEqual(result.strategyMeta.bucketed, true);
  return { cap, bank, rate };
}

async function testArithmeticConsistencyIncomeSurplusCapacity() {
  // Real triad: income 100000, surplus 20000 (20%), capacity 400000 (20× surplus)
  const entities = ents([
    { entityKey: 'inc', realValue: '$100,000', categoryLabel: 'Income' },
    { entityKey: 'sur', realValue: '$20,000', categoryLabel: 'Surplus' },
    { entityKey: 'cap', realValue: '$400,000', categoryLabel: 'Capacity amount' },
  ]);

  const result = await generateSubstitutions({
    entities,
    modelId: null,
    target: {
      consumer: 'frontier-logic-check',
      requirement: REQUIREMENTS.MUST_REMAIN_ARITHMETICALLY_CONSISTENT,
    },
  });

  assert.strictEqual(result.plan.strategyId, 'realistic');
  assert.strictEqual(result.plan.arithmeticConsistent, true);
  assert.strictEqual(result.arithmetic.applied, true);
  assert.strictEqual(result.arithmetic.relationshipId, RELATIONSHIP_ID);
  assert.ok(result.arithmetic.links.length >= 1);

  const incomeSyn = parseMoney(result.map.get('inc'));
  const surplusSyn = parseMoney(result.map.get('sur'));
  const capacitySyn = parseMoney(result.map.get('cap'));
  assert.ok(incomeSyn && surplusSyn && capacitySyn);

  // surplus' ≈ income' * (20000/100000)
  const expectedSurplus = Math.round(incomeSyn * (20000 / 100000));
  assert.strictEqual(surplusSyn, expectedSurplus, `surplus ${surplusSyn} vs expected ${expectedSurplus}`);

  // capacity' ≈ surplus' * (400000/20000)
  const expectedCapacity = Math.round(surplusSyn * (400000 / 20000));
  assert.strictEqual(capacitySyn, expectedCapacity, `capacity ${capacitySyn} vs expected ${expectedCapacity}`);

  // Blackout satisfies for free
  const blackout = await generateSubstitutions({
    entities,
    target: {
      consumer: 'legal-disclosure',
      requirement: REQUIREMENTS.MUST_BE_UNAMBIGUOUSLY_WITHHELD,
    },
    // Even if someone asks for arithmetic + blackout override:
  });
  assert.ok(
    blackout.arithmetic.satisfiedByConstruction
    || blackout.plan.strategyId === 'blackout',
  );

  return {
    incomeSyn,
    surplusSyn,
    capacitySyn,
    links: result.arithmetic.links,
    gap: result.arithmetic.gap,
  };
}

function testUiMappingAndPlan() {
  const plan = resolveSubstitutionPlan({ target: UI_STYLE_TO_TARGET.Realistic });
  assert.strictEqual(plan.strategyId, 'realistic');
  assert.strictEqual(plan.arithmeticConsistent, false);

  const arith = resolveSubstitutionPlan({
    target: { consumer: 'frontier-logic-check', requirement: REQUIREMENTS.MUST_REMAIN_ARITHMETICALLY_CONSISTENT },
  });
  assert.strictEqual(arith.strategyId, 'realistic');
  assert.strictEqual(arith.arithmeticConsistent, true);

  const forced = resolveSubstitutionPlan({
    target: UI_STYLE_TO_TARGET.Realistic,
    strategyOverride: 'blackout',
  });
  assert.strictEqual(forced.strategyId, 'blackout');

  const ids = listStrategies().map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ['blackout', 'generalized', 'realistic']);
}

async function run() {
  testUiMappingAndPlan();
  const blackout = await testBlackoutNoFabrication();
  const realistic = await testRealisticPlausible();
  const generalized = await testGeneralizedBuckets();
  const arithmetic = await testArithmeticConsistencyIncomeSurplusCapacity();

  console.log('OK substitution strategy tests');
  console.log(JSON.stringify({
    targetShape: {
      consumer: 'string (free text)',
      requirement: 'string (free text; known values listed in REQUIREMENTS)',
    },
    strategies: listStrategies(),
    uiMappingPreview: UI_STYLE_TO_TARGET,
    results: { blackout, realistic, generalized, arithmetic },
  }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
