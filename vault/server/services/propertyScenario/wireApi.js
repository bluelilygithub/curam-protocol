'use strict';

/**
 * HTTP-facing wrappers around runFromText / clarify → calculate.
 * Keeps routes thin and lets tests inject mocks without touching
 * parseScenario / grounding / orchestrator internals.
 */

const { runFromText, runFromScenario } = require('./runPipeline');
const { applyClarifications, cloneScenario } = require('./clarify');
const { validateScenario } = require('./validate');
const { buildPresentationPayload } = require('./presentation');

function clarifyingForm(scenario, clarifyingQuestions = [], validation = null) {
  const assumptions = (scenario?.unresolved_assumptions || [])
    .filter((a) => a.severity !== 'optional')
    .map((a) => ({
      id: a.id,
      field_path: a.field_path,
      message: a.message,
      severity: a.severity || 'required',
    }));

  const byMessage = new Set(assumptions.map((a) => String(a.message || '').trim().toLowerCase()));
  const byPath = new Set(assumptions.map((a) => String(a.field_path || '').trim()));

  clarifyingQuestions.forEach((q, i) => {
    const msg = String(q || '').trim();
    if (!msg) return;
    if (byMessage.has(msg.toLowerCase())) return;
    assumptions.push({
      id: `ass_q_ui_${i + 1}`,
      field_path: 'clarifying_questions',
      message: msg,
      severity: 'required',
    });
    byMessage.add(msg.toLowerCase());
  });

  // When grounding strips values, validation errors can remain with no assumption rows.
  // Surface them so the clarify form is never empty while ready_for_calculations is false.
  (validation?.errors || []).forEach((err, i) => {
    const path = String(err.path || '').trim();
    const msg = String(err.message || '').trim();
    if (!path && !msg) return;
    if (path && byPath.has(path)) return;
    const message = path ? `${path}: ${msg}` : msg;
    if (byMessage.has(message.toLowerCase())) return;
    assumptions.push({
      id: `ass_val_${i + 1}_${path.replace(/[^a-z0-9]+/gi, '_') || 'x'}`,
      field_path: path || 'clarifying_questions',
      message,
      severity: 'required',
    });
    byMessage.add(message.toLowerCase());
    if (path) byPath.add(path);
  });

  return assumptions;
}

function withPresentation(base, { scenario, calculation, liveLenders, coverage, lenderFetchError }) {
  if (!calculation || calculation.ok === false) {
    return { ...base, presentation: null };
  }
  try {
    const presentation = buildPresentationPayload({
      scenario,
      calculation,
      liveLenders,
      coverage,
      lenderFetchError,
    });
    return {
      ...base,
      presentation,
      requires_user_decision: presentation.requires_user_decision,
      calculation_ready: true,
    };
  } catch (err) {
    return {
      ...base,
      presentation: null,
      presentation_error: err.message || String(err),
    };
  }
}

function buildPipelineResponse({
  source_text = null,
  scenario,
  parse = null,
  clarification = null,
  validation = null,
  draft_validation = null,
  calculation = null,
  ready_for_calculations,
  clarifying_questions = [],
  livePack = null,
}) {
  const remaining = clarification?.remaining_required
    || (scenario?.unresolved_assumptions || []).filter((a) => a.severity !== 'optional')
    || [];
  const questions = clarifying_questions.length
    ? clarifying_questions
    : remaining.map((a) => a.message).filter(Boolean);

  const base = {
    ok: true,
    source_text,
    scenario,
    parse,
    clarification,
    validation: validation || (scenario ? validateScenario(scenario, { draft: false }) : null),
    draft_validation,
    ready_for_calculations: Boolean(ready_for_calculations),
    clarifying_questions: questions,
    clarifying_form: clarifyingForm(
      scenario,
      questions,
      validation || (scenario ? validateScenario(scenario, { draft: false }) : null)
    ),
    calculation,
  };

  return withPresentation(base, {
    scenario,
    calculation,
    liveLenders: livePack?.live?.ok ? livePack.live.lenders : null,
    coverage: livePack?.live?.coverage || null,
    lenderFetchError: livePack?.live?.ok
      ? null
      : (livePack?.error || livePack?.live?.coverage?.summary || null),
  });
}

/**
 * Parse free text through runFromText. Never throws for LLM/parse failures —
 * returns { ok: false, error: 'parse_failed', message }.
 *
 * @param {{ text: string, asOf?: string, userId?: number, modelId?: string, clarifications?: object }} body
 * @param {{ runFromText?: Function, livePack?: object|null }} [deps]
 */
async function executeParse(body = {}, deps = {}) {
  const text = String(body.text || '').trim();
  if (!text) {
    return {
      ok: false,
      error: 'invalid_request',
      message: 'text is required',
    };
  }

  const run = deps.runFromText || runFromText;

  try {
    const result = await run(text, {
      asOf: body.asOf,
      userId: body.userId,
      modelId: body.modelId,
      clarifications: body.clarifications || {},
    });

    const ready = Boolean(
      result.calculation
      && result.calculation.ok !== false
      && result.clarification?.remaining_required?.length === 0
      && result.validation?.ok
    );

    return buildPipelineResponse({
      source_text: result.source_text || text,
      scenario: result.scenario,
      parse: result.parse,
      clarification: result.clarification,
      validation: result.validation,
      draft_validation: result.draft_validation || null,
      calculation: result.calculation,
      ready_for_calculations: ready,
      clarifying_questions: result.clarification?.clarifying_questions
        || result.parse?.clarifying_questions
        || [],
      livePack: deps.livePack || null,
    });
  } catch (err) {
    return {
      ok: false,
      error: 'parse_failed',
      message: err?.message || String(err),
    };
  }
}

/**
 * Apply clarification answers; run orchestrator only when ready.
 * Never throws — returns structured ok/error.
 *
 * @param {{
 *   scenario: object,
 *   answers?: Record<string, *>,
 *   selling_cost_pct?: number,
 *   resolve_optional?: boolean,
 *   clear_assumptions?: boolean,
 *   scenario_patch?: object,
 *   replace_scenario?: boolean,
 *   source_text?: string,
 * }} body
 * @param {{ runFromScenario?: Function, livePack?: object|null }} [deps]
 */
function executeClarify(body = {}, deps = {}) {
  if (!body.scenario || typeof body.scenario !== 'object') {
    return {
      ok: false,
      error: 'invalid_request',
      message: 'scenario is required',
    };
  }

  try {
    let scenario = cloneScenario(body.scenario);
    const clarify = applyClarifications(scenario, {
      answers: body.answers || {},
      selling_cost_pct: body.selling_cost_pct,
      resolve_optional: body.resolve_optional,
      clear_assumptions: body.clear_assumptions,
      scenario_patch: body.scenario_patch,
      replace_scenario: body.replace_scenario,
    });
    scenario = clarify.scenario;

    const draftValidation = validateScenario(scenario, { draft: true });
    const fullValidation = validateScenario(scenario, { draft: false });
    const remaining_required = clarify.remaining_required;
    const clarifying_questions = remaining_required.map((a) => a.message).filter(Boolean);
    const ready = remaining_required.length === 0 && fullValidation.ok;

    let calculation = null;
    if (ready) {
      const run = deps.runFromScenario || runFromScenario;
      const pack = run(scenario, { clarifications: {}, run: {} });
      scenario = pack.scenario;
      calculation = pack.calculation;
    }

    return buildPipelineResponse({
      source_text: body.source_text || null,
      scenario,
      clarification: {
        applied: clarify.applied,
        remaining_required,
        clarifying_questions,
      },
      validation: fullValidation,
      draft_validation: draftValidation,
      calculation,
      ready_for_calculations: ready && Boolean(calculation) && calculation.ok !== false,
      clarifying_questions,
      livePack: deps.livePack || null,
    });
  } catch (err) {
    return {
      ok: false,
      error: 'clarify_failed',
      message: err?.message || String(err),
    };
  }
}

module.exports = {
  executeParse,
  executeClarify,
  clarifyingForm,
  buildPipelineResponse,
};
