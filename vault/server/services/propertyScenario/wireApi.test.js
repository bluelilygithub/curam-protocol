#!/usr/bin/env node
'use strict';

/**
 * Stage 10 — wireApi /parse + /clarify contract tests.
 * Mocks LLM parse where needed; clarify → orchestrate uses the real calculator path.
 */

const assert = require('assert');
const { executeParse, executeClarify, clarifyingForm } = require('./wireApi');
const { scenarioSellBuySwitchValid, SOURCE_TEXT_SELL_BUY_SWITCH } = require('./fixtures');
const { runFromScenario } = require('./runPipeline');
const { createScenario, createLoanSnapshot } = require('./scenario');

const G = '\x1b[32m';
const R = '\x1b[31m';
const X = '\x1b[0m';

let passed = 0;
let failed = 0;

function test(name, fn) {
  const run = async () => {
    try {
      await fn();
      passed += 1;
      console.log(`${G}✓${X} ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`${R}✗${X} ${name}`);
      console.log(`  ${err.stack || err.message}`);
    }
  };
  return run();
}

function incompleteParseScenario() {
  return createScenario({
    id: 'sc_partial',
    title: 'Partial refinance',
    starting_properties: [{
      id: 'prop_home',
      label: 'Home',
      state: null,
      was_ever_investment_property: false,
      current_loan: createLoanSnapshot({
        balance: 400_000,
        rate: 6.0,
        fixed_or_variable: 'variable',
        term_remaining_months: 300,
        lender: 'DemoBank',
        property_id: 'prop_home',
      }),
    }],
    events: [{
      id: 'ev_refi',
      type: 'refinance',
      sequence: 1,
      label: 'Refinance',
      fields: {
        property_id: 'prop_home',
        current_loan: createLoanSnapshot({
          balance: 400_000,
          rate: 6.0,
          fixed_or_variable: 'variable',
          term_remaining_months: 300,
          lender: 'DemoBank',
        }),
        target_loan: createLoanSnapshot({
          balance: 400_000,
          rate: 5.4,
          fixed_or_variable: 'variable',
          term_remaining_months: 300,
          lender: 'DemoBank',
        }),
      },
    }],
    unresolved_assumptions: [{
      id: 'ass_state',
      field_path: 'starting_properties.0.state',
      message: 'Which Australian state is the property in?',
      severity: 'required',
    }],
  });
}

async function main() {
  await test('invalid parse: missing text → invalid_request (not 500)', async () => {
    const r = await executeParse({ text: '  ' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'invalid_request');
  });

  await test('parse: malformed/failed LLM response → parse_failed structured error', async () => {
    const r = await executeParse(
      { text: 'I want to refinance' },
      {
        runFromText: async () => {
          throw new Error('Scenario parser did not return valid JSON. Preview: (empty)');
        },
      }
    );
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'parse_failed');
    assert.match(r.message, /valid JSON|empty/i);
  });

  await test('parse: successful with clarifying questions (not ready)', async () => {
    const partial = incompleteParseScenario();
    const r = await executeParse(
      { text: "I'm refinancing my home loan" },
      {
        runFromText: async (text) => ({
          source_text: text,
          parse: {
            ready_for_calculations: false,
            clarifying_questions: ['Which Australian state is the property in?'],
            grounding_stripped: [],
            validation: { ok: true, errors: [], warnings: [] },
          },
          clarification: {
            applied: [],
            remaining_required: partial.unresolved_assumptions,
            clarifying_questions: ['Which Australian state is the property in?'],
          },
          scenario: partial,
          draft_validation: { ok: true, errors: [], warnings: [] },
          validation: { ok: false, errors: [{ code: 'state_required', message: 'state required' }], warnings: [] },
          calculation: null,
        }),
      }
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ready_for_calculations, false);
    assert.ok(r.clarifying_form.length >= 1);
    assert.ok(r.clarifying_questions.some((q) => /state/i.test(q)));
    assert.strictEqual(r.presentation, null);
    assert.strictEqual(r.calculation, null);
  });

  await test('parse: ready immediately returns calculation + presentation', async () => {
    const fixture = scenarioSellBuySwitchValid();
    const pack = runFromScenario(fixture, {
      clarifications: {
        selling_cost_pct: 0.025,
        resolve_optional: true,
        clear_assumptions: true,
      },
    });
    assert.ok(pack.calculation?.ok !== false);

    const r = await executeParse(
      { text: SOURCE_TEXT_SELL_BUY_SWITCH },
      {
        runFromText: async (text) => ({
          source_text: text,
          parse: {
            ready_for_calculations: true,
            clarifying_questions: [],
            grounding_stripped: [],
            validation: { ok: true, errors: [], warnings: [] },
          },
          clarification: {
            applied: ['cleared_all_assumptions'],
            remaining_required: [],
            clarifying_questions: [],
          },
          scenario: pack.scenario,
          validation: { ok: true, errors: [], warnings: [] },
          calculation: pack.calculation,
        }),
        livePack: { live: null, error: 'stub for unit test' },
      }
    );

    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ready_for_calculations, true);
    assert.ok(r.calculation);
    assert.ok(r.presentation);
    assert.ok(r.presentation.summary_table);
    assert.strictEqual(
      r.calculation.totals.deposit_funded_from_sale,
      pack.calculation.totals.deposit_funded_from_sale
    );
  });

  await test('clarify: invalid request without scenario', async () => {
    const r = await executeClarify({});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'invalid_request');
  });

  await test('clarify loop: answers → ready_for_calculations (simple refinance)', async () => {
    const partial = incompleteParseScenario();
    const mid = await executeClarify({
      scenario: partial,
      answers: { ass_state: 'NSW' },
    });
    assert.strictEqual(mid.ok, true);
    assert.strictEqual(mid.ready_for_calculations, true, 'should become ready after state answered');
    assert.ok(mid.calculation);
    assert.ok(mid.presentation);
    assert.ok(mid.calculation.event_results?.some((e) => e.type === 'refinance'));
  });

  await test(
    'e2e clarify: Stage 2 compound text path via fixture patch → expected totals',
    async () => {
      // Simulate: LLM returned thin skeleton; user/system supplies ground-truth patch
      // (same shape Stage 4 e2e uses after parse). Assert calc matches pure fixture run.
      const expected = runFromScenario(scenarioSellBuySwitchValid(), {
        clarifications: {
          selling_cost_pct: 0.025,
          resolve_optional: true,
          clear_assumptions: true,
        },
      });

      const skeleton = createScenario({
        id: 'sc_from_parse',
        title: 'Partial compound',
        unresolved_assumptions: [{
          id: 'ass_need_detail',
          field_path: 'clarifying_questions',
          message: 'Please confirm sale price, deposit, and switch terms',
          severity: 'required',
        }],
      });

      const s = scenarioSellBuySwitchValid();
      const result = await executeClarify({
        source_text: SOURCE_TEXT_SELL_BUY_SWITCH,
        scenario: skeleton,
        clear_assumptions: true,
        replace_scenario: true,
        selling_cost_pct: 0.025,
        resolve_optional: true,
        scenario_patch: {
          title: s.title,
          starting_properties: s.starting_properties,
          events: s.events,
          dependencies: s.dependencies.filter((d) => d.kind === 'funds_deposit'),
          timeline: s.timeline,
          unresolved_assumptions: [],
        },
      });

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.ready_for_calculations, true);
      assert.ok(result.calculation);
      assert.strictEqual(
        result.calculation.totals.deposit_funded_from_sale,
        expected.calculation.totals.deposit_funded_from_sale
      );
      assert.strictEqual(
        result.calculation.totals.stamp_duty,
        expected.calculation.totals.stamp_duty
      );
      assert.strictEqual(
        result.calculation.totals.total_costs,
        expected.calculation.totals.total_costs
      );
      assert.ok(result.presentation?.summary_table);
      assert.ok(
        (result.calculation.cash_flow_timeline || []).length > 0,
        'cash-flow timeline present'
      );
    }
  );

  await test('clarifyingForm mirrors questions when assumptions thin', async () => {
    const form = clarifyingForm(
      { unresolved_assumptions: [] },
      ['What is the settlement gap?', 'Is this PPOR?']
    );
    assert.strictEqual(form.length, 2);
    assert.strictEqual(form[0].field_path, 'clarifying_questions');
  });

  await test('clarify failure inside apply is structured clarify_failed', async () => {
    const r = await executeClarify(
      { scenario: incompleteParseScenario(), answers: { ass_state: 'NSW' } },
      {
        runFromScenario: () => {
          throw new Error('orchestrator boom');
        },
      }
    );
    // When ready, runFromScenario is called — injected boom should surface structured
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'clarify_failed');
    assert.match(r.message, /orchestrator boom/);
  });

  await test('validation errors become clarifying_form rows when assumptions empty', async () => {
    const broken = createScenario({
      id: 'sc_broken',
      title: 'Broken buy',
      starting_properties: [],
      events: [{
        id: 'ev_buy',
        type: 'buy',
        sequence: 1,
        fields: {
          property_value: 800_000,
          state: 'NSW',
          is_first_home_buyer: false,
          deposit_amount: 160_000,
          // loan missing balance/rate → validation errors
          loan: {
            balance: null,
            rate: null,
            fixed_or_variable: 'variable',
            term_remaining_months: 360,
          },
        },
      }],
      unresolved_assumptions: [],
    });

    const r = await executeClarify({ scenario: broken });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ready_for_calculations, false);
    assert.ok(r.clarifying_form.length >= 1, 'expected validation-driven form rows');
    assert.ok(r.clarifying_form.some((f) => /loan\.balance|Loan balance/i.test(f.field_path + f.message)));
  });

  await test('clarify answers can fill validation paths to unlock calc', async () => {
    const partial = createScenario({
      id: 'sc_fill',
      title: 'Fill loan',
      starting_properties: [{
        id: 'prop_home',
        state: 'NSW',
        was_ever_investment_property: false,
        current_loan: createLoanSnapshot({
          balance: 400_000,
          rate: 6.0,
          fixed_or_variable: 'variable',
          term_remaining_months: 300,
          property_id: 'prop_home',
        }),
      }],
      events: [{
        id: 'ev_refi',
        type: 'refinance',
        sequence: 1,
        fields: {
          property_id: 'prop_home',
          current_loan: createLoanSnapshot({
            balance: 400_000,
            rate: 6.0,
            fixed_or_variable: 'variable',
            term_remaining_months: 300,
          }),
          target_loan: {
            balance: null,
            rate: null,
            fixed_or_variable: 'variable',
            term_remaining_months: 300,
            lender: 'DemoBank',
          },
        },
      }],
      unresolved_assumptions: [],
    });

    const blocked = await executeClarify({ scenario: partial });
    assert.strictEqual(blocked.ready_for_calculations, false);

    const unlocked = await executeClarify({
      scenario: partial,
      answers: {
        'events.0.fields.target_loan.balance': 400_000,
        'events.0.fields.target_loan.rate': 5.4,
      },
    });
    assert.strictEqual(unlocked.ready_for_calculations, true);
    assert.ok(unlocked.calculation);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
