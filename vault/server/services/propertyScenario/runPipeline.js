'use strict';

const { parseScenario } = require('./parseScenario');
const { applyClarifications, cloneScenario } = require('./clarify');
const { runScenario } = require('./orchestrate');
const { validateScenario } = require('./validate');

/**
 * End-to-end: raw text → parse → clarifications → combined calculation result.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {object} [opts.clarifications] — passed to applyClarifications
 * @param {object} [opts.run] — passed to runScenario
 * @param {number} [opts.userId]
 * @param {string} [opts.modelId]
 * @returns {Promise<object>}
 */
async function runFromText(text, opts = {}) {
  const parsed = await parseScenario(text, {
    userId: opts.userId,
    modelId: opts.modelId,
  });

  let scenario = cloneScenario(parsed.scenario);
  const clarify = applyClarifications(scenario, opts.clarifications || {});
  scenario = clarify.scenario;

  const draftValidation = validateScenario(scenario, { draft: true });
  const fullValidation = validateScenario(scenario, { draft: false });

  const clarifying_questions = (scenario.unresolved_assumptions || [])
    .filter((a) => a.severity !== 'optional')
    .map((a) => a.message);

  let calculation = null;
  if (clarify.remaining_required.length === 0 && fullValidation.ok) {
    calculation = runScenario(scenario, opts.run || {});
  } else if (opts.run?.force) {
    calculation = runScenario(scenario, { ...opts.run, force: true });
  }

  return {
    source_text: text,
    parse: {
      ready_for_calculations: parsed.ready_for_calculations,
      clarifying_questions: parsed.clarifying_questions,
      grounding_stripped: parsed.grounding_stripped || [],
      validation: parsed.validation,
    },
    clarification: {
      applied: clarify.applied,
      remaining_required: clarify.remaining_required,
      clarifying_questions,
    },
    scenario,
    draft_validation: draftValidation,
    validation: fullValidation,
    calculation,
  };
}

/**
 * Run calculation on an already-resolved Scenario (fixtures / post-clarify).
 * @param {import('./scenario').Scenario} scenario
 * @param {object} [opts] — clarify opts + run opts
 */
function runFromScenario(scenario, opts = {}) {
  let s = cloneScenario(scenario);
  const clarify = applyClarifications(s, opts.clarifications || {});
  s = clarify.scenario;
  // runScenario accepts run-level opts (refinance_fees, selling_cost_pct, comparison_rate, force)
  // directly on its opts object — accept them either nested under opts.run (legacy) or as
  // top-level siblings of `clarifications` (used by /calculate route) so callers don't
  // silently lose overrides depending on which shape they used.
  const runOpts = { ...(opts.run || {}) };
  ['refinance_fees', 'selling_cost_pct', 'comparison_rate', 'force'].forEach((key) => {
    if (opts[key] !== undefined && runOpts[key] === undefined) runOpts[key] = opts[key];
  });
  const calculation = runScenario(s, runOpts);
  return {
    clarification: clarify,
    scenario: s,
    calculation,
  };
}

module.exports = {
  runFromText,
  runFromScenario,
};
