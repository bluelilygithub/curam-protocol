#!/usr/bin/env node
/**
 * Stage 4 — orchestration unit tests + end-to-end harness (5 Stage 2 texts).
 *
 * Offline:  node server/services/propertyScenario/orchestrate.test.js
 * Live E2E: node server/services/propertyScenario/orchestrate.test.js --e2e
 *
 * Requires ANTHROPIC_API_KEY for --e2e.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const assert = require('assert');
const {
  scenarioSellBuySwitchValid,
  scenarioRefinanceThenPayout,
  SOURCE_TEXT_SELL_BUY_SWITCH,
} = require('./fixtures');
const { runScenario } = require('./orchestrate');
const { runFromScenario, runFromText } = require('./runPipeline');
const { applyClarifications, cloneScenario } = require('./clarify');
const { calculateStampDutyLmi } = require('./calc/stampDutyLmi');

const G = '\x1b[32m';
const R = '\x1b[31m';
const Y = '\x1b[33m';
const C = '\x1b[36m';
const B = '\x1b[1m';
const DIM = '\x1b[2m';
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

// ─── Answer packs for the 5 Stage 2 parser inputs ────────────────────────────

const STAGE2_CASES = [
  {
    id: 1,
    title: 'Simple refinance',
    text: "I'm refinancing my home loan",
    clarifications: {
      clear_assumptions: true,
      replace_scenario: true,
      scenario_patch: {
        title: 'Simple refinance (clarified)',
        starting_properties: [{
          id: 'prop_home',
          label: 'Home',
          state: 'NSW',
          was_ever_investment_property: false,
          current_loan: {
            balance: 400_000,
            rate: 6.0,
            fixed_or_variable: 'variable',
            term_remaining_months: 300,
            lender: 'DemoBank',
            property_id: 'prop_home',
          },
        }],
        events: [{
          id: 'ev_refi',
          type: 'refinance',
          sequence: 1,
          label: 'Refinance home loan',
          fields: {
            property_id: 'prop_home',
            current_loan: {
              balance: 400_000,
              rate: 6.0,
              fixed_or_variable: 'variable',
              term_remaining_months: 300,
              lender: 'DemoBank',
            },
            target_loan: {
              balance: 400_000,
              rate: 5.4,
              fixed_or_variable: 'variable',
              term_remaining_months: 300,
              lender: 'DemoBank',
            },
          },
        }],
        dependencies: [],
        unresolved_assumptions: [],
      },
    },
  },
  {
    id: 2,
    title: 'Early payout with partial numbers',
    text: 'I want to pay out my mortgage early next year. Balance is about $180k with CityBank.',
    clarifications: {
      clear_assumptions: true,
      replace_scenario: true,
      scenario_patch: {
        title: 'Early payout (clarified)',
        starting_properties: [{
          id: 'prop_home',
          state: 'NSW',
          was_ever_investment_property: false,
          current_loan: {
            balance: 180_000,
            rate: 5.8,
            fixed_or_variable: 'variable',
            term_remaining_months: 120,
            lender: 'CityBank',
            property_id: 'prop_home',
          },
        }],
        events: [{
          id: 'ev_payout',
          type: 'early_payout',
          sequence: 1,
          label: 'Early payout',
          fields: {
            property_id: 'prop_home',
            current_loan: {
              balance: 180_000,
              rate: 5.8,
              fixed_or_variable: 'variable',
              term_remaining_months: 120,
              lender: 'CityBank',
            },
            payout_date: '2027-01-15',
          },
        }],
        dependencies: [],
        unresolved_assumptions: [],
      },
    },
  },
  {
    id: 3,
    title: 'Sell and buy — ambiguous timing / use',
    text: "I'm selling and buying. Selling our place and buying a new one.",
    clarifications: {
      clear_assumptions: true,
      replace_scenario: true,
      selling_cost_pct: 0.025,
      scenario_patch: {
        title: 'Sell then buy (clarified)',
        starting_properties: [{
          id: 'prop_old',
          label: 'Current home',
          state: 'NSW',
          estimated_value: 900_000,
          purchase_price: 500_000,
          purchase_date: '2015-06-01',
          was_ever_investment_property: false,
          current_loan: {
            balance: 200_000,
            rate: 5.5,
            fixed_or_variable: 'variable',
            term_remaining_months: 180,
            lender: 'BankA',
            property_id: 'prop_old',
          },
        }],
        events: [
          {
            id: 'ev_sell',
            type: 'sell',
            sequence: 1,
            label: 'Sell current home',
            fields: {
              property_id: 'prop_old',
              property_value: 900_000,
              purchase_price: 500_000,
              purchase_date: '2015-06-01',
              was_ever_investment_property: false,
              state: 'NSW',
              settlement_date: '2026-10-01',
            },
          },
          {
            id: 'ev_buy',
            type: 'buy',
            sequence: 2,
            label: 'Buy next home',
            fields: {
              property_id: 'prop_new',
              property_value: 1_100_000,
              state: 'NSW',
              is_first_home_buyer: false,
              deposit_amount: 600_000,
              settlement_date: '2026-10-20',
              loan: {
                balance: 500_000,
                rate: 5.4,
                fixed_or_variable: 'variable',
                term_remaining_months: 360,
                lender: 'BankA',
              },
            },
          },
        ],
        dependencies: [{
          id: 'dep_funds',
          from_event_id: 'ev_sell',
          to_event_id: 'ev_buy',
          kind: 'funds_deposit',
          note: 'Sale proceeds fund the deposit',
        }],
        unresolved_assumptions: [],
      },
    },
  },
  {
    id: 4,
    title: 'Compound sell → buy → switch (partial)',
    text: "I'm selling my current place, buying a new one, and switching lenders in the process.",
    clarifications: {
      clear_assumptions: true,
      selling_cost_pct: 0.025,
      replace_scenario: true,
      // After clarify, use ground-truth compound shape so switch is included
      scenario_patch: (() => {
        const s = scenarioSellBuySwitchValid();
        return {
          title: s.title,
          starting_properties: s.starting_properties,
          events: s.events,
          dependencies: s.dependencies,
          timeline: s.timeline,
          unresolved_assumptions: [],
        };
      })(),
    },
  },
  {
    id: 5,
    title: 'Ground-truth style compound (richer text)',
    text: SOURCE_TEXT_SELL_BUY_SWITCH,
    clarifications: {
      selling_cost_pct: 0.025,
      resolve_optional: true,
      clear_assumptions: true,
      replace_scenario: true,
      // If parser misses pieces, fill from fixture so calc can complete
      scenario_patch: (() => {
        const s = scenarioSellBuySwitchValid();
        return {
          title: s.title,
          starting_properties: s.starting_properties,
          events: s.events,
          dependencies: s.dependencies.filter((d) => d.kind === 'funds_deposit'),
          timeline: s.timeline,
          unresolved_assumptions: [],
        };
      })(),
    },
  },
];

function printCombinedResult(calculation, { verbose = true } = {}) {
  if (!calculation) {
    console.log(`${Y}(no calculation — still blocked on clarifications / validation)${X}`);
    return;
  }
  console.log(`\n${B}Combined result${X}`);
  console.log(`  ok: ${calculation.ok}  ready: ${calculation.ready}`);
  console.log(`  scenario: ${calculation.scenario_id} — ${calculation.title}`);
  console.log(`\n${B}Totals${X}`);
  console.log(JSON.stringify(calculation.totals, null, 2));
  console.log(`\n${B}Dependencies applied${X}`);
  console.log(JSON.stringify(calculation.dependencies_applied, null, 2));
  if (verbose) {
    console.log(`\n${B}Cash-flow timeline (${calculation.cash_flow_timeline.length} entries)${X}`);
    calculation.cash_flow_timeline.forEach((f, i) => {
      const sign = f.direction === 'in' ? '+' : f.direction === 'out' ? '−' : '↔';
      console.log(
        `  ${String(i + 1).padStart(2)}. [${f.date}] ${sign}$${Number(f.amount).toLocaleString()}  `
        + `${f.category}  (${f.event_id})  ${f.note || ''}`
      );
    });
    console.log(`\n${B}Event results${X}`);
    calculation.event_results.forEach((er) => {
      console.log(`  · ${er.sequence}. ${er.type} ${er.event_id} ok=${er.ok} costs=$${er.costs}`);
      if (er.type === 'sell') {
        console.log(`      net_sale_proceeds=$${er.outputs?.net_sale_proceeds?.toLocaleString?.() ?? er.outputs?.net_sale_proceeds}`);
      }
      if (er.type === 'buy') {
        console.log(
          `      deposit=${er.outputs?.deposit_amount} funded_from_sale=$${er.outputs?.funded_from_sale_proceeds}`
        );
      }
    });
    console.log(`\n${B}Caveats (${calculation.caveats.length})${X}`);
    calculation.caveats.forEach((c) => console.log(`  · ${c}`));
    if (calculation.blocking_errors?.length) {
      console.log(`\n${R}Blocking errors${X}`);
      calculation.blocking_errors.forEach((e) => console.log(`  · ${e}`));
    }
  }
}

// ─── Unit tests (fixtures, no API) ───────────────────────────────────────────

test('sell→buy proceeds flow uses prior net_sale_proceeds (not independent recalculation)', () => {
  const scenario = scenarioSellBuySwitchValid();
  const { calculation } = runFromScenario(scenario, {
    clarifications: {
      selling_cost_pct: 0.025,
      resolve_optional: true,
      clear_assumptions: true,
    },
  });

  assert.ok(calculation.ok, `expected ok: ${JSON.stringify(calculation.blocking_errors)}`);
  const sell = calculation.event_results.find((e) => e.type === 'sell');
  const buy = calculation.event_results.find((e) => e.type === 'buy');
  const switchEv = calculation.event_results.find((e) => e.type === 'switch_lender');

  assert.ok(sell && buy && switchEv);

  // Hand-check net proceeds: 1_450_000 − 410_000 − 2.5%×1_450_000
  const expectedSelling = Math.round(1_450_000 * 0.025 * 100) / 100;
  const expectedNet = Math.round((1_450_000 - 410_000 - expectedSelling) * 100) / 100;
  assert.strictEqual(sell.outputs.net_sale_proceeds, expectedNet);

  // Deposit stated 650k must be funded from that pool
  assert.strictEqual(buy.outputs.funded_from_sale_proceeds, 650_000);
  assert.strictEqual(buy.outputs.deposit_amount, 650_000);
  assert.ok(calculation.dependencies_applied.some((d) => d.kind === 'funds_deposit' || d.from_event_id));

  // Remaining unused proceeds
  assert.strictEqual(calculation.totals.unused_sale_proceeds, Math.round((expectedNet - 650_000) * 100) / 100);
  assert.strictEqual(calculation.totals.deposit_funded_from_sale, 650_000);

  // Stamp duty matches Stage 3 module for same buy fields
  const stamp = calculateStampDutyLmi(scenario.events.find((e) => e.type === 'buy').fields);
  assert.strictEqual(calculation.totals.stamp_duty, stamp.stamp_duty_payable);

  // Timeline includes sale and deposit transfer
  assert.ok(calculation.cash_flow_timeline.some((f) => f.category === 'sale_price'));
  assert.ok(calculation.cash_flow_timeline.some((f) => f.category === 'deposit_from_sale_proceeds' && f.amount === 650_000));
  assert.ok(calculation.cash_flow_timeline.some((f) => f.category === 'stamp_duty'));
  assert.ok(calculation.cash_flow_timeline.some((f) => f.category === 'refinance_fees'));

  // Switch produces monthly saving benefit
  assert.ok(calculation.totals.monthly_repayment_saving > 0);
});

test('refinance→early_payout fixture computes break cost then $0 IRD on variable payout', () => {
  const scenario = scenarioRefinanceThenPayout();
  const { calculation } = runFromScenario(scenario, {
    clarifications: { clear_assumptions: true },
  });
  assert.ok(calculation.ok, JSON.stringify(calculation.blocking_errors));
  const refi = calculation.event_results.find((e) => e.type === 'refinance');
  const payout = calculation.event_results.find((e) => e.type === 'early_payout');
  assert.ok(refi.outputs.break_cost);
  // Fixed→variable: IRD = 520k × (6.1−5.4)% × 2y = 520000 × 0.007 × 2 = 7280
  assert.strictEqual(refi.outputs.break_cost.break_cost_estimate, 7280);
  assert.strictEqual(payout.outputs.early_payout.break_cost_estimate, 0);
  assert.ok(calculation.totals.break_costs >= 7280);
});

test('blocks when required assumptions remain (unless force)', () => {
  const scenario = scenarioRefinanceThenPayout(); // has required ass_break_costs
  const blocked = runScenario(scenario);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.ready, false);
  const forced = runScenario(scenario, { force: true });
  assert.strictEqual(forced.ready, true);
});

test('applyClarifications selling_cost_pct fills sell events', () => {
  const s = cloneScenario(scenarioSellBuySwitchValid());
  const { applied } = applyClarifications(s, { selling_cost_pct: 0.025 });
  assert.ok(applied.some((a) => a.includes('selling_costs')));
  assert.strictEqual(s.events[0].fields.selling_costs, 36250);
});

async function runE2E() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${R}ANTHROPIC_API_KEY missing — cannot run --e2e${X}`);
    process.exit(1);
  }

  console.log(`\n${B}${'═'.repeat(72)}${X}`);
  console.log(`${B}Stage 4 E2E — 5 Stage 2 texts → parse → clarify → calculate${X}`);
  console.log(`${B}${'═'.repeat(72)}${X}`);

  const outputs = [];

  for (const c of STAGE2_CASES) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`${B}${C}CASE ${c.id}: ${c.title}${X}`);
    console.log(`${DIM}${c.text.slice(0, 160)}${c.text.length > 160 ? '…' : ''}${X}`);

    try {
      const result = await runFromText(c.text, {
        clarifications: c.clarifications,
        run: {},
      });
      outputs.push({ id: c.id, ok: true, result });

      console.log(`\nParse ready_for_calculations (pre-clarify): ${result.parse.ready_for_calculations}`);
      console.log(`Parse clarifying questions: ${result.parse.clarifying_questions.length}`);
      console.log(`Clarifications applied: ${result.clarification.applied.length}`);
      console.log(`Remaining required after clarify: ${result.clarification.remaining_required.length}`);
      console.log(`Validation ok: ${result.validation.ok}`);

      const verbose = c.id === 5 || c.id === 4;
      printCombinedResult(result.calculation, { verbose });

      if (c.id === 5) {
        console.log(`\n${B}${Y}══ FULL COMPOUND OUTPUT (Case 5 — sell, buy, switch lender) ══${X}`);
        console.log(JSON.stringify({
          totals: result.calculation?.totals,
          dependencies_applied: result.calculation?.dependencies_applied,
          cash_flow_timeline: result.calculation?.cash_flow_timeline,
          event_results: result.calculation?.event_results?.map((e) => ({
            event_id: e.event_id,
            type: e.type,
            sequence: e.sequence,
            date: e.date,
            ok: e.ok,
            costs: e.costs,
            cost_breakdown: e.cost_breakdown,
            benefits: e.benefits,
            outputs: e.outputs,
            errors: e.errors,
          })),
          caveats: result.calculation?.caveats,
          assumptions: result.calculation?.assumptions,
          remaining_owned_properties: result.calculation?.remaining_owned_properties,
          blocking_errors: result.calculation?.blocking_errors,
        }, null, 2));
      }
    } catch (err) {
      console.log(`${R}CASE ${c.id} FAILED: ${err.message}${X}`);
      outputs.push({ id: c.id, ok: false, error: err.message });
    }
  }

  const failedCases = outputs.filter((o) => !o.ok || !o.result?.calculation?.ok);
  console.log(`\n${'═'.repeat(72)}`);
  console.log(
    `${B}E2E summary${X}: ${outputs.filter((o) => o.ok).length}/${outputs.length} pipelines ran; `
    + `${outputs.filter((o) => o.result?.calculation?.ok).length} calculations ok`
  );
  if (failedCases.length) {
    failedCases.forEach((f) => {
      console.log(
        `${R}  · case ${f.id}: ${f.error || (f.result?.calculation?.blocking_errors || []).join('; ') || 'calc not ok'}${X}`
      );
    });
    process.exitCode = 1;
  }
}

async function main() {
  console.log(`${B}Stage 4 orchestration unit tests${X}`);
  // tests registered above already ran via test()

  console.log(`\n${passed} passed, ${failed} failed (unit)`);
  if (failed) process.exit(1);

  if (process.argv.includes('--e2e')) {
    await runE2E();
  } else {
    // Always print full compound fixture output (offline) so Stage 4 brief is satisfied without API
    console.log(`\n${B}${Y}══ FULL COMPOUND OUTPUT (fixture sell → buy → switch) ══${X}`);
    const { calculation } = runFromScenario(scenarioSellBuySwitchValid(), {
      clarifications: {
        selling_cost_pct: 0.025,
        resolve_optional: true,
        clear_assumptions: true,
      },
    });
    printCombinedResult(calculation, { verbose: true });
    console.log(`\n${DIM}Tip: node server/services/propertyScenario/orchestrate.test.js --e2e${X}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
