'use strict';

/**
 * Property / Mortgage Scenario Agent — Stages 1–10
 * Data model, NLP parse with deterministic pre-extraction, grounding, scenario calc,
 * orchestration, standalone calculators, presentation, CDR PRD rates, bridging modelling,
 * and live HTTP/UI wiring for runFromText (Stage 10).
 *
 * Open/deferred work: see OPEN_ITEMS.md
 */

const constants = require('./constants');
const {
  createScenario,
  createLoanSnapshot,
  orderedEvents,
} = require('./scenario');
const { validateScenario, assertValidScenario } = require('./validate');
const fixtures = require('./fixtures');
const {
  parseScenario,
  normalizeParsedScenario,
  buildClarifyingQuestions,
  groundScenarioAgainstText,
  findUngroundedCriticalFields,
} = require('./parseScenario');
const calc = require('./calc');
const { runScenario } = require('./orchestrate');
const { applyClarifications, cloneScenario } = require('./clarify');
const { runFromText, runFromScenario } = require('./runPipeline');
const presentation = require('./presentation');
const { MOCK_LENDERS } = require('./mockLenders');
const cdr = require('./cdr');
const { extractSpans, formatSpansForPrompt } = require('./extractSpans');
const { executeParse, executeClarify } = require('./wireApi');

module.exports = {
  ...constants,
  createScenario,
  createLoanSnapshot,
  orderedEvents,
  validateScenario,
  assertValidScenario,
  parseScenario,
  normalizeParsedScenario,
  buildClarifyingQuestions,
  groundScenarioAgainstText,
  findUngroundedCriticalFields,
  calc,
  ...calc,
  runScenario,
  applyClarifications,
  cloneScenario,
  runFromText,
  runFromScenario,
  presentation,
  ...presentation,
  MOCK_LENDERS,
  cdr,
  getLiveMortgageLenders: cdr.getLiveMortgageLenders,
  extractSpans,
  formatSpansForPrompt,
  executeParse,
  executeClarify,
  fixtures,
  GROUND_TRUTH_CASES: fixtures.GROUND_TRUTH_CASES,
  NEGATIVE_CASES: fixtures.NEGATIVE_CASES,
};
