#!/usr/bin/env node
/**
 * Stage 2 — NLP parse_scenario live tests (calls Anthropic).
 * Run: node server/services/propertyScenario/parseScenario.test.js
 *
 * Requires ANTHROPIC_API_KEY. Optional: PROPERTY_SCENARIO_MODEL, DATABASE_URL (vault_models).
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { parseScenario, normalizeParsedScenario, buildClarifyingQuestions } = require('./parseScenario');
const { validateScenario } = require('./validate');
const { SOURCE_TEXT_SELL_BUY_SWITCH } = require('./fixtures');

const G = '\x1b[32m';
const R = '\x1b[31m';
const C = '\x1b[36m';
const Y = '\x1b[33m';
const B = '\x1b[1m';
const DIM = '\x1b[2m';
const X = '\x1b[0m';

/** Five inputs of increasing complexity (Stage 2 brief). */
const CASES = [
  {
    id: 1,
    title: 'Simple refinance',
    text: "I'm refinancing my home loan",
  },
  {
    id: 2,
    title: 'Early payout with partial numbers',
    text: 'I want to pay out my mortgage early next year. Balance is about $180k with CityBank.',
  },
  {
    id: 3,
    title: 'Sell and buy — ambiguous timing / use',
    text: "I'm selling and buying. Selling our place and buying a new one.",
  },
  {
    id: 4,
    title: 'Compound sell → buy → switch (partial)',
    text: "I'm selling my current place, buying a new one, and switching lenders in the process.",
  },
  {
    id: 5,
    title: 'Ground-truth style compound (richer text)',
    text: SOURCE_TEXT_SELL_BUY_SWITCH,
  },
];

function summarizeScenario(scenario) {
  return {
    id: scenario.id,
    title: scenario.title,
    starting_properties: (scenario.starting_properties || []).map((p) => ({
      id: p.id,
      label: p.label,
      state: p.state,
      estimated_value: p.estimated_value,
      has_loan: Boolean(p.current_loan),
      loan_balance: p.current_loan?.balance,
    })),
    events: (scenario.events || []).map((e) => ({
      id: e.id,
      type: e.type,
      sequence: e.sequence,
      label: e.label,
      fields: e.fields,
    })),
    dependencies: scenario.dependencies,
    timeline: scenario.timeline,
    unresolved_assumptions: scenario.unresolved_assumptions,
  };
}

function printResult(caseMeta, result) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`${B}${C}CASE ${caseMeta.id}: ${caseMeta.title}${X}`);
  console.log(`${DIM}Input:${X} ${caseMeta.text.slice(0, 220)}${caseMeta.text.length > 220 ? '…' : ''}`);
  console.log(`${'─'.repeat(72)}`);
  console.log(`${Y}ready_for_calculations:${X} ${result.ready_for_calculations}`);
  console.log(`${Y}draft validation ok:${X} ${result.validation.ok}`
    + (result.validation.errors.length ? ` (${result.validation.errors.length} errors)` : '')
    + (result.validation.warnings.length ? ` (${result.validation.warnings.length} warnings)` : ''));

  console.log(`\n${B}Clarifying questions (${result.clarifying_questions.length})${X}`);
  if (!result.clarifying_questions.length) {
    console.log('  (none)');
  } else {
    result.clarifying_questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  }

  console.log(`\n${B}Parsed scenario${X}`);
  console.log(JSON.stringify(summarizeScenario(result.scenario), null, 2));

  if (result.validation.errors.length) {
    console.log(`\n${R}Structural errors${X}`);
    result.validation.errors.forEach((e) => console.log(`  · [${e.code}] ${e.path || ''}: ${e.message}`));
  }
  if (result.validation.warnings.length) {
    console.log(`\n${Y}Draft warnings (missing calc fields)${X}`);
    result.validation.warnings.slice(0, 12).forEach((e) => {
      console.log(`  · [${e.code}] ${e.path || ''}: ${e.message}`);
    });
    if (result.validation.warnings.length > 12) {
      console.log(`  … +${result.validation.warnings.length - 12} more`);
    }
  }
}

async function runUnitSmoke() {
  const normalized = normalizeParsedScenario({
    scenario: {
      id: 'sc_unit',
      events: [{ id: 'ev_1', type: 'refinance', sequence: 1, fields: { property_id: 'prop_a' } }],
      unresolved_assumptions: [{ id: 'ass_1', field_path: 'x', message: 'What is the balance?', severity: 'required' }],
    },
    clarifying_questions: ['What rate are you on?'],
  });
  const qs = buildClarifyingQuestions(normalized, ['What rate are you on?', 'What is the balance?']);
  if (qs.length !== 2) throw new Error(`expected 2 clarifying questions, got ${qs.length}`);
  const draft = validateScenario(normalized, { draft: true });
  // Missing starting property for refinance → still a hard error
  if (draft.ok) throw new Error('expected structural fail for refinance without owned property');
  console.log(`${G}✓${X} unit smoke (normalize + clarifying questions + draft validate)`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${R}ANTHROPIC_API_KEY missing — cannot run Stage 2 live parse tests.${X}`);
    process.exit(1);
  }

  await runUnitSmoke();

  const outputs = [];
  for (const c of CASES) {
    process.stdout.write(`\n${DIM}Parsing case ${c.id}…${X}`);
    try {
      const result = await parseScenario(c.text);
      printResult(c, result);
      outputs.push({ id: c.id, ok: true, result });
    } catch (err) {
      console.log(`\n${R}CASE ${c.id} FAILED:${X} ${err.message}`);
      outputs.push({ id: c.id, ok: false, error: err.message });
    }
  }

  const failed = outputs.filter((o) => !o.ok).length;
  const withQuestions = outputs.filter((o) => o.ok && o.result.clarifying_questions.length > 0).length;
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`${B}Summary${X}: ${outputs.length - failed}/${outputs.length} parsed, ${withQuestions} produced clarifying questions`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
