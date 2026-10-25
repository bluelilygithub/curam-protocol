'use strict';

// Topic Research: write a first draft from a research brief.
//   build the prompt from the brief only (prompt.js) -> ask the model the owner chose -> read its JSON -> check it hard (schema.js) -> if it is
//   unusable, ask once more naming what was wrong -> look for copied wording (overlap.js) -> log what it cost.
// The model sees the brief, never the articles' text. The model is the one chosen in Settings -> Topic Research, else the workspace default
// (modelResolver.js: no id is written here). An error message here never contains the prompt, the brief or anything from the provider's error.
// Everything outside is injected, so tests need no network, key or database. See docs/topic-research.md.

const { buildPrompt, buildRetryPrompt } = require('./prompt');
const { validateDraft, textFields, LENGTHS, DEFAULT_LENGTH } = require('./schema');
const { findOverlaps } = require('../brief/overlap');
const { textFields: briefTextFields } = require('../brief/schema');
const { normaliseUrl } = require('../urlNormalise');

const MAX_OUTPUT_TOKENS = 6000;
const TIMEOUT_MS = 150000;

const fail = (status, message) => Object.assign(new Error(message), { status });

function readReply(reply) {
  if (typeof reply === 'string') return { text: reply, inputTokens: 0, outputTokens: 0 };
  return { text: String(reply?.text || ''), inputTokens: Number(reply?.inputTokens) || 0, outputTokens: Number(reply?.outputTokens) || 0 };
}

// each default is loaded only if the caller did not inject one, so a test that injects everything never touches the database module
const DEFAULTS = {
  callModel: () => require('../../callModel').callModel,
  resolveModel: () => require('../modelResolver').resolveTopicResearchModel,
  logUsage: () => require('../../../utils/logUsage').logUsage,
  calculateCost: () => require('../../costCalculator').calculateCost,
  log: () => (err) => require('../../../middleware/requestContext').getLogger().warn({ err }, 'topic research draft model call failed'),
  parse: () => require('../../../utils/parseModelJson').parseModelJson,
};
const withDefaults = (given) => Object.fromEntries(Object.entries(DEFAULTS).map(([k, load]) => [k, given[k] || load()]));

/**
 * @param input  { userId, topic: { keyword, region }, settings, brief, sources, articles, lengthChoice, steer }
 *               brief: the validated brief (brief/schema.js shape); sources: [{ url, title, domain }] in the brief's citation order;
 *               articles: [{ url, title, snippet, text }] only for the copy check (never sent to the model)
 * @returns {{ draft, overlap, dropped, words, model, inputTokens, outputTokens, costUsd, attempts }}
 */
async function generateDraft(input, depsIn = {}) {
  const deps = withDefaults(depsIn);
  const { userId, topic, settings, brief, sources = [], articles = [], steer = '' } = input;
  const lengthChoice = LENGTHS[input.lengthChoice] ? input.lengthChoice : DEFAULT_LENGTH;

  // the only source numbers a draft may cite are those the brief's own facts cite
  const cited = new Set((brief?.keyFacts || []).flatMap((f) => f.sources));
  const allowed = new Map();
  sources.forEach((s, i) => { if (cited.has(s.url)) allowed.set(i + 1, s.url); });
  if (!brief || !allowed.size) throw fail(400, 'This brief has no sourced facts to write a draft from.');

  const model = await deps.resolveModel(userId);
  if (!model) throw fail(503, 'No AI model is set up for this workspace yet. Ask your admin to add one in Settings.');

  const { system, user } = buildPrompt({ topic, settings, brief, sources, lengthChoice, steer });

  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let validated = null;
  let problems = [];
  try {
    let message = user;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      attempts = attempt;
      let reply;
      try {
        reply = readReply(await deps.callModel(model, message, { system, maxTokens: MAX_OUTPUT_TOKENS, returnUsage: true, timeoutMs: TIMEOUT_MS }));
      } catch (err) {
        deps.log(err);
        throw fail(502, /timed out/i.test(String(err?.message)) ? 'The AI model took too long to answer. Try again, or choose a shorter draft.' : 'The AI model could not be reached just now. Try again in a minute.');
      }
      inputTokens += reply.inputTokens;
      outputTokens += reply.outputTokens;
      const parsed = deps.parse(reply.text);
      if (parsed === null) problems = ['The answer was not valid JSON (it may have been cut off). Reply with one complete JSON object, and keep it shorter.'];
      else {
        validated = validateDraft(parsed, { allowed, lengthChoice });
        problems = validated.problems;
      }
      if (!problems.length) break;
      message = buildRetryPrompt(user, problems);
    }
  } finally {
    // the tokens were spent whether or not the answer was usable
    if (inputTokens || outputTokens) deps.logUsage({ userId, model, inputTokens, outputTokens, feature: 'topic_research_draft' });
  }
  if (problems.length) throw fail(502, 'The AI model\'s answer could not be used, even after a second try. Try again, or choose a different length.');

  // copy check: the articles' own words, and the brief's (a draft that just pastes the brief's sentences is not a draft)
  const sourcesText = articles.map((a) => ({ url: normaliseUrl(a.url) || a.url, title: a.title, texts: [a.title, a.snippet, a.text] }));
  sourcesText.push({ url: 'brief', title: 'your research brief', texts: briefTextFields(brief).map((f) => f.text) });
  const overlap = findOverlaps(textFields(validated.value), sourcesText);
  const costUsd = deps.calculateCost(model, inputTokens, outputTokens);
  return { draft: validated.value, overlap, dropped: validated.dropped, words: validated.words, model, inputTokens, outputTokens, costUsd, attempts };
}

module.exports = { generateDraft, MAX_OUTPUT_TOKENS, TIMEOUT_MS };
