'use strict';

const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { createScenario, createLoanSnapshot } = require('./scenario');
const { validateScenario } = require('./validate');
const { PARSE_SYSTEM, buildParsePrompt } = require('./parsePrompt');
const {
  groundScenarioAgainstText,
  findUngroundedCriticalFields,
} = require('./grounding');
const { extractSpans } = require('./extractSpans');

/**
 * @typedef {object} ParseScenarioResult
 * @property {import('./scenario').Scenario} scenario
 * @property {string[]} clarifying_questions — surface these before any calculations
 * @property {{ ok: boolean, errors: object[], warnings: object[] }} validation
 * @property {boolean} ready_for_calculations — true only when no required assumptions and scenario validates
 * @property {string[]} [grounding_stripped] — fields removed because not grounded in source text
 */

function normalizeLoan(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  return createLoanSnapshot({
    balance: raw.balance,
    rate: raw.rate,
    fixed_or_variable: raw.fixed_or_variable,
    term_remaining_months: raw.term_remaining_months ?? raw.term_remaining,
    fixed_period_remaining_months:
      raw.fixed_period_remaining_months
      ?? raw.fixed_term_remaining_months
      ?? raw.remaining_fixed_months,
    lender: raw.lender,
    property_id: raw.property_id,
  });
}

function normalizeAssumption(a, i) {
  return {
    id: a.id || `ass_${i + 1}`,
    field_path: a.field_path || a.path || `unknown[${i}]`,
    message: a.message || a.question || 'Clarification needed',
    severity: a.severity === 'optional' ? 'optional' : 'required',
  };
}

function stripZeroPlaceholders(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'number' && v === 0) {
      // LLM often fills unknown numerics with 0 — treat as missing
      delete out[k];
    }
  }
  return out;
}

/**
 * Coerce LLM JSON into a Scenario via createScenario.
 * @param {object} raw
 * @returns {import('./scenario').Scenario}
 */
function normalizeParsedScenario(raw) {
  const src = raw?.scenario && typeof raw.scenario === 'object' ? raw.scenario : raw;
  const starting = (src.starting_properties || []).map((p) => {
    const cleaned = stripZeroPlaceholders(p);
    return {
      ...cleaned,
      current_loan: cleaned.current_loan
        ? normalizeLoan(stripZeroPlaceholders(cleaned.current_loan))
        : undefined,
    };
  });

  const events = (src.events || []).map((e) => {
    const fields = stripZeroPlaceholders({ ...(e.fields || {}) });
    if (fields.loan) fields.loan = normalizeLoan(stripZeroPlaceholders(fields.loan));
    if (fields.current_loan) fields.current_loan = normalizeLoan(stripZeroPlaceholders(fields.current_loan));
    if (fields.target_loan) fields.target_loan = normalizeLoan(stripZeroPlaceholders(fields.target_loan));
    return {
      id: e.id,
      type: e.type,
      sequence: e.sequence,
      label: e.label,
      fields,
    };
  });

  return createScenario({
    id: src.id || `sc_${Date.now()}`,
    title: src.title || '',
    currency: src.currency || 'AUD',
    starting_properties: starting,
    events,
    dependencies: (src.dependencies || []).filter(
      (d) => d?.from_event_id && d?.to_event_id && d.from_event_id !== d.to_event_id
    ),
    timeline: src.timeline || { gaps: [], overlaps: [] },
    unresolved_assumptions: (src.unresolved_assumptions || []).map(normalizeAssumption),
  });
}

function normalizeQuestionKey(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Derive user-facing questions from assumptions + optional LLM list.
 * Required assumptions always become questions; optional are included too.
 * @param {import('./scenario').Scenario} scenario
 * @param {string[]} [fromModel]
 * @returns {string[]}
 */
function buildClarifyingQuestions(scenario, fromModel = []) {
  const fromAssumptions = (scenario.unresolved_assumptions || [])
    .map((a) => String(a.message || '').trim())
    .filter(Boolean);

  const fromLlm = (fromModel || [])
    .map((q) => String(q || '').trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const q of [...fromAssumptions, ...fromLlm]) {
    const key = normalizeQuestionKey(q);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

function hasRequiredAssumptions(scenario) {
  return (scenario.unresolved_assumptions || []).some((a) => a.severity !== 'optional');
}

/**
 * Resolve which model to call.
 * Avoids requiring modelResolver/DB unless userId is provided (CLI harness stays offline-capable).
 * @param {{ userId?: number, modelId?: string }} opts
 */
async function resolveParseModel(opts = {}) {
  if (opts.modelId) return opts.modelId;
  if (opts.userId) {
    const { getModelsForUser } = require('../modelResolver');
    const models = await getModelsForUser(opts.userId);
    if (models.standard) return models.standard;
  }
  if (process.env.PROPERTY_SCENARIO_MODEL) return process.env.PROPERTY_SCENARIO_MODEL;
  if (process.env.ANTHROPIC_API_KEY) {
    return 'claude-sonnet-4-6';
  }
  throw new Error(
    'No model configured for property scenario parsing. Pass modelId / userId or set PROPERTY_SCENARIO_MODEL.'
  );
}

/**
 * Parse free-text into a Scenario + clarifying questions.
 * Does NOT run financial calculations. Callers must surface clarifying_questions
 * (and block calc when ready_for_calculations is false).
 *
 * @param {string} text
 * @param {{ userId?: number, modelId?: string, asOf?: string|Date }} [opts]
 * @returns {Promise<ParseScenarioResult>}
 */
async function parseScenario(text, opts = {}) {
  const input = String(text || '').trim();
  if (!input) {
    throw new Error('parseScenario: text is required');
  }

  // Stage 9: deterministic pre-extraction — assignment spans for the LLM (no field binding here)
  const spanPack = extractSpans(input, { asOf: opts.asOf });

  const modelId = await resolveParseModel(opts);
  const prompt = buildParsePrompt(input, { spanPack });

  const result = await callModel(modelId, prompt, {
    system: PARSE_SYSTEM,
    maxTokens: 4096,
    returnUsage: true,
  });

  if (opts.userId) {
    try {
      const { logUsage } = require('../../utils/logUsage');
      logUsage({
        userId: opts.userId,
        model: result.model || modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        feature: 'property_scenario_parse',
      });
    } catch {
      /* usage logging optional */
    }
  }

  const parsed = parseModelJson(String(result.text || '').trim());
  if (!parsed || typeof parsed !== 'object') {
    const preview = String(result.text || '').slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`Scenario parser did not return valid JSON. Preview: ${preview || '(empty)'}`);
  }

  const scenario = normalizeParsedScenario(parsed);

  // Structural safety net: strip invented state / PPOR / FHB / unspanned numerics
  const grounding = groundScenarioAgainstText(scenario, input, {
    spans: spanPack.spans,
    asOf: spanPack.as_of,
  });

  let clarifying_questions = buildClarifyingQuestions(
    scenario,
    parsed.clarifying_questions || parsed.questions
  );

  // Ensure every clarifying question is reflected as an assumption (for later gating)
  const existingKeys = new Set(
    (scenario.unresolved_assumptions || []).map((a) => normalizeQuestionKey(a.message))
  );
  clarifying_questions.forEach((q, i) => {
    const key = normalizeQuestionKey(q);
    if (!key || existingKeys.has(key)) return;
    scenario.unresolved_assumptions.push({
      id: `ass_q_${i + 1}`,
      field_path: 'clarifying_questions',
      message: q,
      severity: 'required',
    });
    existingKeys.add(key);
  });

  // Rebuild questions after grounding assumptions were added
  clarifying_questions = buildClarifyingQuestions(scenario, clarifying_questions);

  // Drop self-referential dependencies the model sometimes emits (invalid by Stage 1 rules)
  scenario.dependencies = (scenario.dependencies || []).filter(
    (d) => d.from_event_id && d.to_event_id && d.from_event_id !== d.to_event_id
  );

  const validation = validateScenario(scenario, { draft: true });
  const ready_for_calculations = validation.ok
    && !hasRequiredAssumptions(scenario)
    && validateScenario(scenario, { draft: false }).ok;

  return {
    scenario,
    clarifying_questions,
    validation,
    ready_for_calculations,
    grounding_stripped: grounding.stripped,
  };
}

module.exports = {
  parseScenario,
  normalizeParsedScenario,
  buildClarifyingQuestions,
  resolveParseModel,
  groundScenarioAgainstText,
  findUngroundedCriticalFields,
  extractSpans,
};
