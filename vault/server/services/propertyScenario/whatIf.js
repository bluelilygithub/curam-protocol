'use strict';

/**
 * Stage 12 (additive): "What if…" scenario mutation.
 *
 * Distinct from Stage 11 insights and from advice/ask — those explain existing
 * numbers and never touch totals. This module DOES change totals, but only via
 * the same deterministic path as everything else: the LLM may only pick a
 * field_path that already exists on the scenario (from a whitelist we build by
 * walking the object) and assign it a plain number/string. Nothing else is
 * writable, and the value is applied through the same applyClarifications()
 * used by the real clarify flow — no shadow scenario mutation logic here.
 *
 * Same honesty bar as parse/grounding: LLM proposes, deterministic code disposes.
 */

const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { applyClarifications, cloneScenario } = require('./clarify');
const { validateScenario } = require('./validate');
const { runFromScenario } = require('./runPipeline');
const { buildPresentationPayload } = require('./presentation');

// Leaf fields a what-if is allowed to touch. Structural fields (ids, type,
// sequence, dependencies) are never in the whitelist — only editable numbers/
// enums a broker would plausibly want to flex.
const EDITABLE_LEAF_KEYS = new Set([
  'balance', 'rate', 'fixed_or_variable', 'term_remaining_months',
  'fixed_period_remaining_months', 'property_value', 'purchase_price',
  'deposit_amount', 'selling_costs', 'cgt_cost_base', 'years_owned', 'lvr',
]);

/**
 * Walk the scenario and collect { field_path, current_value } for every
 * whitelisted leaf — this is the ONLY vocabulary handed to the LLM.
 */
function collectEditableFields(scenario) {
  const out = [];

  function walkLoan(basePath, loan) {
    if (!loan || typeof loan !== 'object') return;
    for (const [k, v] of Object.entries(loan)) {
      if (EDITABLE_LEAF_KEYS.has(k) && (typeof v === 'number' || typeof v === 'string')) {
        out.push({ field_path: `${basePath}.${k}`, current_value: v });
      }
    }
  }

  (scenario.starting_properties || []).forEach((p, i) => {
    const base = `starting_properties[${i}]`;
    for (const [k, v] of Object.entries(p)) {
      if (k === 'current_loan') { walkLoan(`${base}.current_loan`, v); continue; }
      if (EDITABLE_LEAF_KEYS.has(k) && (typeof v === 'number' || typeof v === 'string')) {
        out.push({ field_path: `${base}.${k}`, current_value: v });
      }
    }
  });

  (scenario.events || []).forEach((e, i) => {
    const base = `events[${i}].fields`;
    for (const [k, v] of Object.entries(e.fields || {})) {
      if (['current_loan', 'target_loan', 'new_loan', 'refinance_loan', 'bridging_loan'].includes(k)) {
        walkLoan(`${base}.${k}`, v);
        continue;
      }
      if (EDITABLE_LEAF_KEYS.has(k) && (typeof v === 'number' || typeof v === 'string')) {
        out.push({ field_path: `${base}.${k}`, current_value: v });
      }
    }
  });

  return out;
}

async function resolveModel(opts = {}) {
  if (opts.modelId) return opts.modelId;
  if (opts.userId) {
    const { getModelsForUser } = require('../modelResolver');
    const models = await getModelsForUser(opts.userId);
    if (models.light || models.standard) return models.light || models.standard;
  }
  if (process.env.PROPERTY_SCENARIO_MODEL) return process.env.PROPERTY_SCENARIO_MODEL;
  throw new Error('No model configured for what-if parsing.');
}

const WHAT_IF_SYSTEM = [
  'You convert a plain-English "what if" question into a small list of field changes',
  'on an existing property scenario. You may ONLY use field_path values from the',
  'provided whitelist — never invent a path, never touch anything not listed.',
  'One change per distinct value the user mentions. If the question does not map',
  'to any whitelisted field, return an empty changes array and explain why in "note".',
  'Respond with JSON only: { "changes": [{ "field_path": "...", "value": <number|string>, "description": "..." }], "note": "..." }',
].join(' ');

function buildWhatIfPrompt(question, editableFields) {
  const list = editableFields
    .map((f) => `- ${f.field_path} = ${f.current_value}`)
    .join('\n');
  return [
    'Editable fields (field_path = current value):',
    list || '(none)',
    '',
    `What-if question: ${question}`,
  ].join('\n');
}

/**
 * Run a what-if: parse the question into whitelisted field changes, apply them
 * to a CLONE of the scenario, recalculate, and return original vs what-if
 * totals side by side. The original scenario/calculation are never mutated.
 *
 * @param {{ scenario: object, question: string, userId?: number, modelId?: string }} opts
 */
async function runWhatIf(opts = {}) {
  const { scenario, question } = opts;
  if (!scenario || typeof scenario !== 'object') {
    return { ok: false, error: 'invalid_request', message: 'scenario is required' };
  }
  if (!question || !String(question).trim()) {
    return { ok: false, error: 'invalid_request', message: 'question is required' };
  }

  const editableFields = collectEditableFields(scenario);
  if (!editableFields.length) {
    return {
      ok: false,
      error: 'no_editable_fields',
      message: 'This scenario has no fields a what-if can adjust.',
    };
  }

  const modelId = await resolveModel(opts);
  const prompt = buildWhatIfPrompt(question, editableFields);

  let parsed;
  try {
    const result = await callModel(modelId, prompt, { system: WHAT_IF_SYSTEM, maxTokens: 500 });
    parsed = parseModelJson(String(result || '').trim());
  } catch (err) {
    return { ok: false, error: 'what_if_failed', message: err.message || String(err) };
  }

  const rawChanges = Array.isArray(parsed?.changes) ? parsed.changes : [];
  const validPaths = new Set(editableFields.map((f) => f.field_path));

  // Grounding: same rule as everywhere else in this module — only apply a
  // change whose field_path was actually offered. Silently invented paths
  // (LLM slipping outside the whitelist) are dropped, not applied.
  const answers = {};
  const appliedChanges = [];
  const rejectedChanges = [];
  rawChanges.forEach((c) => {
    const path = String(c?.field_path || '');
    if (!validPaths.has(path)) {
      rejectedChanges.push({ field_path: path, reason: 'not_in_whitelist' });
      return;
    }
    if (c.value == null || (typeof c.value !== 'number' && typeof c.value !== 'string')) {
      rejectedChanges.push({ field_path: path, reason: 'invalid_value' });
      return;
    }
    answers[path] = c.value;
    appliedChanges.push({
      field_path: path,
      from: editableFields.find((f) => f.field_path === path)?.current_value,
      to: c.value,
      description: c.description || null,
    });
  });

  if (!appliedChanges.length) {
    return {
      ok: false,
      error: 'no_applicable_change',
      message: parsed?.note || 'Could not map that question to an adjustable field.',
      rejected: rejectedChanges,
    };
  }

  const whatIfScenario = cloneScenario(scenario);
  applyClarifications(whatIfScenario, { answers, resolve_optional: true });
  const validation = validateScenario(whatIfScenario, { draft: false });
  if (!validation.ok) {
    return {
      ok: false,
      error: 'what_if_invalid',
      message: 'Applying that change leaves the scenario incomplete or invalid.',
      validation,
      appliedChanges,
    };
  }

  let originalCalc = null;
  try {
    originalCalc = runFromScenario(cloneScenario(scenario), { clarifications: {}, run: {} }).calculation;
  } catch (err) {
    originalCalc = null;
  }

  const { calculation, scenario: resolvedWhatIf } = runFromScenario(whatIfScenario, {
    clarifications: {},
    run: {},
  });

  const presentation = buildPresentationPayload({
    scenario: resolvedWhatIf,
    calculation,
    liveLenders: null,
    coverage: null,
    lenderFetchError: null,
  });

  return {
    ok: true,
    appliedChanges,
    rejectedChanges,
    note: parsed?.note || null,
    original_totals: originalCalc?.totals || null,
    what_if_totals: calculation?.totals || null,
    what_if_presentation: presentation,
    what_if_scenario: resolvedWhatIf,
    disclaimer: 'Exploratory what-if — not a new quote or approval. Verify with your broker before acting.',
  };
}

module.exports = {
  runWhatIf,
  collectEditableFields,
  EDITABLE_LEAF_KEYS,
};
