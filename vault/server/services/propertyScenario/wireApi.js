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
  state: 'State',
  ppor: 'Is this your primary place of residence (PPOR)?',
  is_ppor: 'Is this your primary place of residence (PPOR)?',
  was_ever_investment_property: 'Was this ever an investment property?',
  deposit_amount: 'Deposit amount ($)',
  property_value: 'Property value ($)',
  purchase_price: 'Original purchase price ($)',
  purchase_date: 'Date of purchase',
  settlement_date: 'Settlement date',
  selling_costs: 'Selling costs ($)',
  balance: 'Loan balance ($)',
  rate: 'Interest rate (%)',
  fixed_or_variable: 'Rate type',
  term_remaining_months: 'Loan term remaining (months)',
  fixed_period_remaining_months: 'Fixed-rate period remaining (months)',
  cgt_cost_base: 'CGT cost base ($)',
  years_owned: 'Years owned',
  property_id: 'Which property',
  lvr: 'Loan-to-value ratio (LVR %)',
};

const FIELD_PLACEHOLDER_OVERRIDES = {
  balance: 'e.g. 520000',
  rate: 'Defaults to live market average',
  term_remaining_months: 'e.g. 300',
  fixed_period_remaining_months: 'e.g. 24',
  deposit_amount: 'e.g. 200000',
  property_value: 'e.g. 1400000',
  purchase_price: 'e.g. 720000',
  cgt_cost_base: 'e.g. 720000',
  lvr: 'e.g. 80',
  years_owned: 'e.g. 8',
};

function humanizeLastSegment(fieldPath) {
  if (!fieldPath || fieldPath === 'clarifying_questions') return '';
  const parts = String(fieldPath).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  const last = parts[parts.length - 1];
  return FIELD_LABEL_OVERRIDES[last]
    || last.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function placeholderForLastSegment(fieldPath) {
  if (!fieldPath) return '';
  const parts = String(fieldPath).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  return FIELD_PLACEHOLDER_OVERRIDES[parts[parts.length - 1]] || '';
}

// ── Loan object expansion ─────────────────────────────────────────────────────

// Sub-fields required for every loan snapshot (in display order)
const LOAN_SUB_FIELDS = [
  { sub: 'balance',                       label: 'Loan balance ($)',                           type: 'number',    placeholder: 'e.g. 520000' },
  { sub: 'rate',                          label: 'Interest rate (%)',                           type: 'number',    placeholder: 'Defaults to live market average' },
  { sub: 'fixed_or_variable',             label: 'Rate type',                                  type: 'rate_type', placeholder: '' },
  { sub: 'term_remaining_months',         label: 'Loan term remaining (months)',                type: 'number',    placeholder: 'e.g. 300' },
  { sub: 'fixed_period_remaining_months', label: 'Fixed-rate period remaining (months)',        type: 'number',    placeholder: 'e.g. 24 — omit if variable' },
];

const LOAN_PATH_RE = /\.(current_loan|target_loan|new_loan|refinance_loan|bridging_loan)$/;
const LOAN_SUB_PATH_RE = /\.(current_loan|target_loan|new_loan|refinance_loan|bridging_loan)\.(\w+)$/;

const LOAN_KIND_LABELS = {
  current_loan:   'Current loan',
  target_loan:    'Target loan',
  new_loan:       'New loan',
  refinance_loan: 'Refinance loan',
  bridging_loan:  'Bridging loan',
};

function isLoanObjectPath(path) {
  return LOAN_PATH_RE.test(String(path || ''));
}

/** Return enriched meta when path is a leaf inside a loan object, e.g. …current_loan.rate */
function getLoanSubFieldMeta(fieldPath) {
  const m = String(fieldPath || '').match(LOAN_SUB_PATH_RE);
  if (!m) return null;
  const kindLabel = LOAN_KIND_LABELS[m[1]] || 'Loan';
  const sub = m[2];
  const def = LOAN_SUB_FIELDS.find((f) => f.sub === sub);
  if (!def) return null;
  return {
    label: `${kindLabel} — ${def.label}`,
    type: def.type,
    placeholder: def.placeholder,
  };
}

/** Navigate a scenario object by a dotted/bracket path string. */
function getByPath(obj, pathStr) {
  const parts = String(pathStr || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Expand a loan object path into individual sub-field rows.
 * Skips fields that are already resolved in existingLoan, and skips
 * fixed_period_remaining_months when the loan is known to be variable.
 */
function expandLoanObjectPath(basePath, parentId, existingLoan = null) {
  const kindKey = (String(basePath).match(LOAN_PATH_RE) || [])[1] || 'loan';
  const kindLabel = LOAN_KIND_LABELS[kindKey] || 'Loan';
  const isVariable = existingLoan?.fixed_or_variable === 'variable';

  return LOAN_SUB_FIELDS
    .filter(({ sub }) => {
      // Skip sub-fields already set in the scenario
      if (existingLoan != null) {
        const val = existingLoan[sub];
        if (val != null && val !== '' && val !== false) return false;
      }
      // Fixed period only relevant for fixed-rate loans
      if (sub === 'fixed_period_remaining_months' && isVariable) return false;
      return true;
    })
    .map(({ sub, label, type, placeholder }) => ({
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
  // BUG (Round 3): default parameters only apply when the argument is `undefined` —
  // callers passing `clarifying_questions: null` explicitly (LLM returned null instead
  // of an empty array) bypassed the default and crashed on `.forEach` below. Normalize
  // defensively instead of trusting the default parameter alone.
  const questions = Array.isArray(clarifyingQuestions) ? clarifyingQuestions : [];
  const result = [];
  const byMessage = new Set();
  const byPath = new Set();
  const byLabel = new Set(); // also dedup by humanized label to prevent semantic duplicates

  function addRow(row) {
    // 'clarifying_questions' is a sentinel path shared by all narrative questions —
    // don't block on it; use message/label dedup only for that category.
    if (row.field_path && row.field_path !== 'clarifying_questions' && byPath.has(row.field_path)) return;
    if (byMessage.has(String(row.message || '').trim().toLowerCase())) return;
    const lk = String(row.label || '').trim().toLowerCase();
    if (lk && byLabel.has(lk)) return;
    result.push(row);
    if (row.field_path) byPath.add(row.field_path);
    byMessage.add(String(row.message || '').trim().toLowerCase());
    if (lk) byLabel.add(lk);
  }

  function addLoanExpansion(basePath, parentId) {
    const existingLoan = getByPath(scenario, basePath);
    expandLoanObjectPath(basePath, parentId, existingLoan).forEach((row) => {
      if (!byPath.has(row.field_path)) {
        result.push(row);
        byPath.add(row.field_path);
        byLabel.add(String(row.label || '').trim().toLowerCase());
      }
    });
  }

  // 1. Unresolved assumptions from the scenario
  (scenario?.unresolved_assumptions || [])
    .filter((a) => a.severity !== 'optional')
    .forEach((a) => {
      const path = String(a.field_path || '');

      if (isLoanObjectPath(path)) {
        addLoanExpansion(path, a.id);
        return;
      }

      // Enrich loan sub-field assumptions with kind-prefixed label + type + placeholder
      const loanMeta = getLoanSubFieldMeta(path);
      addRow({
        id: a.id,
        field_path: path,
        label: loanMeta?.label || humanizeLastSegment(path) || a.message,
        message: a.message,
        type: loanMeta?.type,
        placeholder: loanMeta?.placeholder || placeholderForLastSegment(path),
        severity: a.severity || 'required',
      });
    });

  // 2. Validation errors — surface BEFORE narrative questions so real field rows
  //    take priority and prevent duplicate narrative rows for the same concept.
  (validation?.errors || []).forEach((err, i) => {
    const path = String(err.path || '').trim();
    const msg = String(err.message || '').trim();
    if (!path && !msg) return;
    if (path && byPath.has(path)) return;

    if (isLoanObjectPath(path)) {
      addLoanExpansion(path, `val_${i}`);
      return;
    }

    const loanMeta = getLoanSubFieldMeta(path);
    addRow({
      id: `ass_val_${i + 1}_${path.replace(/[^a-z0-9]+/gi, '_') || 'x'}`,
      field_path: path || 'clarifying_questions',
      label: loanMeta?.label || (path ? humanizeLastSegment(path) : msg),
      message: msg,
      type: loanMeta?.type,
      placeholder: loanMeta?.placeholder || placeholderForLastSegment(path),
      severity: 'required',
    });
  });

  // 3. Narrative clarifying questions LAST — skipped when the concept is already
  //    covered by a real field-path row (byLabel dedup catches this).
  questions.forEach((q, i) => {
    const msg = String(q || '').trim();
    if (!msg) return;
    addRow({
      id: `ass_q_ui_${i + 1}`,
      field_path: 'clarifying_questions',
      label: msg,
      message: msg,
      type: undefined,
      placeholder: 'Your answer…',
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
  // BUG (Round 3): `clarifying_questions` explicitly passed as null (not just omitted)
  // bypassed the `= []` default parameter and crashed on `.length` — normalize defensively.
  const safeClarifyingQuestions = Array.isArray(clarifying_questions) ? clarifying_questions : [];
  const questions = safeClarifyingQuestions.length
    ? safeClarifyingQuestions
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
