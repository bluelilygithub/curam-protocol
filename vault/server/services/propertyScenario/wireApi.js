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

// ── Label helpers ─────────────────────────────────────────────────────────────

const FIELD_LABEL_OVERRIDES = {
  state: 'State (NSW, VIC, QLD, SA, WA, TAS, ACT, NT)',
  ppor: 'Is this your primary place of residence (PPOR)?',
  is_ppor: 'Is this your primary place of residence (PPOR)?',
  was_ever_investment_property: 'Was this ever an investment property?',
  deposit_amount: 'Deposit amount ($)',
  property_value: 'Property value ($)',
  purchase_price: 'Original purchase price ($)',
  purchase_date: 'Date of purchase',
  settlement_date: 'Settlement date',
  selling_costs: 'Selling costs ($)',
  balance: 'Current loan balance ($)',
  rate: 'Interest rate (%)',
  fixed_or_variable: 'Rate type',
  term_remaining_months: 'Loan term remaining (months)',
  fixed_period_remaining_months: 'Fixed-rate period remaining (months)',
  cgt_cost_base: 'CGT cost base ($)',
  years_owned: 'Years owned',
  property_id: 'Which property',
  lvr: 'Loan-to-value ratio (LVR %)',
};

function humanizeLastSegment(fieldPath) {
  if (!fieldPath || fieldPath === 'clarifying_questions') return '';
  const parts = String(fieldPath).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  const last = parts[parts.length - 1];
  return FIELD_LABEL_OVERRIDES[last]
    || last.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// ── Loan object expansion ─────────────────────────────────────────────────────

// Sub-fields required for every loan snapshot (in display order)
const LOAN_SUB_FIELDS = [
  { sub: 'balance',                    label: 'Loan balance ($)',                      type: 'number',    placeholder: 'e.g. 520000' },
  { sub: 'rate',                       label: 'Interest rate (%)',                      type: 'number',    placeholder: 'e.g. 6.10' },
  { sub: 'fixed_or_variable',          label: 'Rate type',                              type: 'rate_type', placeholder: '' },
  { sub: 'term_remaining_months',      label: 'Months remaining on loan term',          type: 'number',    placeholder: 'e.g. 300' },
  { sub: 'fixed_period_remaining_months', label: 'Months remaining on fixed-rate period (if fixed)', type: 'number', placeholder: 'e.g. 24 — leave blank if variable' },
];

const LOAN_PATH_RE = /\.(current_loan|target_loan|new_loan|refinance_loan|bridging_loan)$/;

function isLoanObjectPath(path) {
  return LOAN_PATH_RE.test(String(path || ''));
}

const LOAN_KIND_LABELS = {
  current_loan: 'Current loan',
  target_loan: 'Target loan',
  new_loan: 'New loan',
  refinance_loan: 'Refinance loan',
  bridging_loan: 'Bridging loan',
};

function expandLoanObjectPath(basePath, parentId) {
  const kindKey = (String(basePath).match(LOAN_PATH_RE) || [])[1] || 'loan';
  const kindLabel = LOAN_KIND_LABELS[kindKey] || 'Loan';
  return LOAN_SUB_FIELDS.map(({ sub, label, type, placeholder }) => ({
    id: `${parentId}_${sub}`,
    field_path: `${basePath}.${sub}`,
    label: `${kindLabel} — ${label}`,
    message: `${kindLabel} — ${label}`,
    type,
    placeholder,
    severity: 'required',
  }));
}

// ── Form builder ──────────────────────────────────────────────────────────────

function clarifyingForm(scenario, clarifyingQuestions = [], validation = null) {
  const result = [];
  const byMessage = new Set();
  const byPath = new Set();

  function addRow(row) {
    if (byPath.has(row.field_path)) return;
    if (byMessage.has(String(row.message || '').trim().toLowerCase())) return;
    result.push(row);
    if (row.field_path) byPath.add(row.field_path);
    byMessage.add(String(row.message || '').trim().toLowerCase());
  }

  // 1. Unresolved assumptions from the scenario
  (scenario?.unresolved_assumptions || [])
    .filter((a) => a.severity !== 'optional')
    .forEach((a) => {
      const path = String(a.field_path || '');

      if (isLoanObjectPath(path)) {
        // Expand object-path loan assumption into individual leaf rows
        expandLoanObjectPath(path, a.id).forEach((row) => {
          if (!byPath.has(row.field_path)) {
            result.push(row);
            byPath.add(row.field_path);
          }
        });
        return;
      }

      addRow({
        id: a.id,
        field_path: path,
        label: humanizeLastSegment(path) || a.message,
        message: a.message,
        type: undefined,
        placeholder: '',
        severity: a.severity || 'required',
      });
    });

  // 2. Narrative clarifying questions from the LLM parse (field_path = sentinel)
  clarifyingQuestions.forEach((q, i) => {
    const msg = String(q || '').trim();
    if (!msg) return;
    addRow({
      id: `ass_q_ui_${i + 1}`,
      field_path: 'clarifying_questions',
      label: msg,
      message: msg,
      type: undefined,
      placeholder: 'Your answer',
      severity: 'required',
    });
  });

  // 3. Validation errors — surface only when not already covered by an assumption row
  (validation?.errors || []).forEach((err, i) => {
    const path = String(err.path || '').trim();
    const msg = String(err.message || '').trim();
    if (!path && !msg) return;
    if (path && byPath.has(path)) return;

    if (isLoanObjectPath(path)) {
      expandLoanObjectPath(path, `val_${i}`).forEach((row) => {
        if (!byPath.has(row.field_path)) {
          result.push(row);
          byPath.add(row.field_path);
        }
      });
      return;
    }

    addRow({
      id: `ass_val_${i + 1}_${path.replace(/[^a-z0-9]+/gi, '_') || 'x'}`,
      field_path: path || 'clarifying_questions',
      label: path ? humanizeLastSegment(path) : msg,
      message: msg,          // just the human message, never path-prefixed
      type: undefined,
      placeholder: '',
      severity: 'required',
    });
  });

  return result;
}

// ── Presentation helper ────────────────────────────────────────────────────────

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

// ── executeParse ─────────────────────────────────────────────────────────────

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

// ── executeClarify ─────────────────────────────────────────────────────────────

/**
 * Apply clarification answers; run orchestrator only when ready.
 * Now async: when free-text clarification answers are present alongside
 * source_text, re-runs runFromText with the augmented text so the LLM can
 * pick up values the user described in plain-English answers.
 * Never throws — returns structured ok/error.
 *
 * @param {{
 *   scenario: object,
 *   answers?: Record<string, *>,
 *   free_text_clarifications?: Array<{ id, question, answer }>,
 *   selling_cost_pct?: number,
 *   resolve_optional?: boolean,
 *   clear_assumptions?: boolean,
 *   scenario_patch?: object,
 *   replace_scenario?: boolean,
 *   source_text?: string,
 * }} body
 * @param {{ runFromText?: Function, runFromScenario?: Function, livePack?: object|null }} [deps]
 */
async function executeClarify(body = {}, deps = {}) {
  if (!body.scenario || typeof body.scenario !== 'object') {
    return {
      ok: false,
      error: 'invalid_request',
      message: 'scenario is required',
    };
  }

  try {
    let scenario = cloneScenario(body.scenario);

    // Re-parse with augmented text when the user answered narrative questions
    // (field_path: 'clarifying_questions') that can't be written to scenario fields directly.
    const freeTextClarifications = Array.isArray(body.free_text_clarifications)
      ? body.free_text_clarifications.filter((c) => c && String(c.answer || '').trim())
      : [];

    if (freeTextClarifications.length > 0 && body.source_text) {
      const augmentation = freeTextClarifications
        .map(({ question, answer }) => `${String(question || '').trim()}\n${String(answer).trim()}`)
        .join('\n\n');
      const augmentedText = `${body.source_text}\n\nAdditional context from user:\n${augmentation}`;
      try {
        const run = deps.runFromText || runFromText;
        const reparsed = await run(augmentedText, {
          asOf: body.asOf,
          userId: body.userId,
          modelId: body.modelId,
        });
        if (reparsed?.scenario) {
          scenario = reparsed.scenario;
        }
      } catch {
        // Fall through: use the existing scenario and let validation surface remaining gaps
      }
    }

    // Apply direct field-path answers on top of the (possibly re-parsed) scenario
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
