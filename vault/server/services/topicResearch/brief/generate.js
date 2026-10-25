'use strict';

// Topic Research: write a research brief from the articles the owner ticked.
//   build the prompt (prompt.js) -> ask the workspace's model -> read its JSON -> check it hard (schema.js) -> if it is unusable, ask once more
//   naming what was wrong -> look for copied wording (overlap.js) -> log what it cost.
// The model is the one the owner picked in Settings -> Topic Research, else the workspace default (never a hardcoded id: modelResolver.js).
// Nothing the model says is trusted until it has passed
// schema.js. An error message here never contains the prompt, article text or anything from the provider's error, only what happened.
// Everything outside is injected, so tests need no network, key or database. See docs/topic-research.md.

const { buildPrompt, buildRetryPrompt } = require('./prompt');
const { validateBrief, textFields } = require('./schema');
const { findOverlaps } = require('./overlap');
const { normaliseUrl } = require('../urlNormalise');

const MAX_OUTPUT_TOKENS = 6000;
const TIMEOUT_MS = 150000;

const fail = (status, message) => Object.assign(new Error(message), { status });

/** The model's answer as text, and the tokens it used (callModel with returnUsage gives an object). */
function readReply(reply) {
  if (typeof reply === 'string') return { text: reply, inputTokens: 0, outputTokens: 0 };
  return { text: String(reply?.text || ''), inputTokens: Number(reply?.inputTokens) || 0, outputTokens: Number(reply?.outputTokens) || 0 };
}

// each default is loaded only if the caller did not inject one, so a test that injects everything never touches the database module
const DEFAULTS = {
  callModel: () => require('../../callModel').callModel,
  // the model is the one the owner chose in Settings -> Topic Research, or the workspace default (modelResolver.js: no id is written here)
  resolveModel: () => require('../modelResolver').resolveTopicResearchModel,
  logUsage: () => require('../../../utils/logUsage').logUsage,
  calculateCost: () => require('../../costCalculator').calculateCost,
  log: () => (err) => require('../../../middleware/requestContext').getLogger().warn({ err }, 'topic research brief model call failed'),
  parse: () => require('../../../utils/parseModelJson').parseModelJson,
};
const withDefaults = (given) => Object.fromEntries(Object.entries(DEFAULTS).map(([k, load]) => [k, given[k] || load()]));

/**
 * @param input  { userId, topic: { keyword, region }, settings, heat, extras, articles, angle }
 *               articles: [{ url, title, domain, publishedAt, score, snippet, text }] in citation order
 * @returns {{ brief, overlap, dropped, model, inputTokens, outputTokens, costUsd, attempts }}
 */
async function generateBrief(input, depsIn = {}) {
  const deps = withDefaults(depsIn);
  const { userId, topic, settings, heat, extras, articles, angle = '' } = input;
  if (!articles?.length) throw fail(400, 'Tick at least one article to write a brief from.');

  const model = await deps.resolveModel(userId);
  if (!model) throw fail(503, 'No AI model is set up for this workspace yet. Ask your admin to add one in Settings.');

  const allowed = new Map();
  for (const a of articles) {
    const url = normaliseUrl(a.url) || a.url;
    allowed.set(url, { url, domain: a.domain });
  }
  const { system, user } = buildPrompt({ topic, settings, heat, extras, articles, angle });

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
        throw fail(502, /timed out/i.test(String(err?.message)) ? 'The AI model took too long to answer. Try again, or tick fewer articles.' : 'The AI model could not be reached just now. Try again in a minute.');
      }
      inputTokens += reply.inputTokens;
      outputTokens += reply.outputTokens;
      const parsed = deps.parse(reply.text);
      if (parsed === null) problems = ['The answer was not valid JSON (it may have been cut off). Reply with one complete JSON object, and keep it shorter.'];
      else {
        validated = validateBrief(parsed, { allowed, fallbackAngle: angle });
        problems = validated.problems;
      }
      if (!problems.length) break;
      message = buildRetryPrompt(user, problems);
    }
  } finally {
    // the tokens were spent whether or not the answer was usable
    if (inputTokens || outputTokens) deps.logUsage({ userId, model, inputTokens, outputTokens, feature: 'topic_research_brief' });
  }
  if (problems.length) throw fail(502, 'The AI model\'s answer could not be used, even after a second try. Try again, or tick fewer articles.');

  const overlap = findOverlaps(textFields(validated.value), articles.map((a) => ({ url: normaliseUrl(a.url) || a.url, title: a.title, texts: [a.title, a.snippet, a.text] })));
  const costUsd = deps.calculateCost(model, inputTokens, outputTokens);
  return { brief: validated.value, overlap, dropped: validated.dropped, model, inputTokens, outputTokens, costUsd, attempts };
}

module.exports = { generateBrief, MAX_OUTPUT_TOKENS, TIMEOUT_MS };
