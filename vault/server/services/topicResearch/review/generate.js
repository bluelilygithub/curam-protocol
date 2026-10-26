'use strict';

// Topic Research: ask a second model for a verdict on how to structure the essay.
//   build the prompt from the brief and the draft backbone (prompt.js) -> ask the model the owner chose for this job -> read its JSON -> check it
//   hard (schema.js) -> if it is unusable, ask once more naming what was wrong -> log what it cost.
// The model sees the brief and the draft, never the articles' text. The model is the one chosen in Settings -> Topic Research "Structure opinion
// model", else the one that writes briefs (modelResolver.js: no id is written here). An error message here never contains the prompt, the draft
// or anything from the provider's error. Everything outside is injected, so tests need no network, key or database.

const { buildPrompt, buildRetryPrompt } = require('./prompt');
const { validateReview } = require('./schema');
const { NOOP } = require('../progress');

const MAX_OUTPUT_TOKENS = 4000;
const TIMEOUT_MS = 120000;

const fail = (status, message) => Object.assign(new Error(message), { status });

function readReply(reply) {
  if (typeof reply === 'string') return { text: reply, inputTokens: 0, outputTokens: 0 };
  return { text: String(reply?.text || ''), inputTokens: Number(reply?.inputTokens) || 0, outputTokens: Number(reply?.outputTokens) || 0 };
}

const DEFAULTS = {
  callModel: () => require('../../callModel').callModel,
  resolveModel: () => require('../modelResolver').resolveReviewModel,
  logUsage: () => require('../../../utils/logUsage').logUsage,
  calculateCost: () => require('../../costCalculator').calculateCost,
  log: () => (err) => require('../../../middleware/requestContext').getLogger().warn({ err }, 'topic research review model call failed'),
  parse: () => require('../../../utils/parseModelJson').parseModelJson,
};
const withDefaults = (given) => Object.fromEntries(Object.entries(DEFAULTS).map(([k, load]) => [k, given[k] || load()]));

/**
 * @param input { userId, topic: { keyword, region }, settings, brief, draft, sources: [{ url, title, domain }] }
 * @returns {{ review, dropped, model, inputTokens, outputTokens, costUsd, attempts, prompt }}
 */
async function generateReview(input, depsIn = {}) {
  const deps = withDefaults(depsIn);
  const report = input.report || NOOP;
  const { userId, topic, settings, brief, draft, sources = [] } = input;
  if (!brief || !draft || !Array.isArray(draft.sections) || !draft.sections.length) throw fail(400, 'This draft has nothing to review yet.');

  const model = await deps.resolveModel(userId);
  if (!model) throw fail(503, 'No AI model is set up for this workspace yet. Ask your admin to add one in Settings.');

  const { system, user } = buildPrompt({ topic, settings, brief, draft, sources });

  let sentRetry = null; // the extra text added to the prompt on a second try, if there was one
  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let validated = null;
  let problems = [];
  try {
    let message = user;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      attempts = attempt;
      report.start('write', attempt === 1 ? 'Waiting for the AI model' : 'The first answer could not be used: trying once more');
      let reply;
      try {
        reply = readReply(await deps.callModel(model, message, { system, maxTokens: MAX_OUTPUT_TOKENS, returnUsage: true, timeoutMs: TIMEOUT_MS }));
      } catch (err) {
        deps.log(err);
        throw fail(502, /timed out/i.test(String(err?.message)) ? 'The AI model took too long to answer. Try again.' : 'The AI model could not be reached just now.');
      }
      inputTokens += reply.inputTokens;
      outputTokens += reply.outputTokens;
      const parsed = deps.parse(reply.text);
      if (parsed === null) problems = ['The answer was not valid JSON (it may have been cut off). Reply with one complete JSON object, and keep it shorter.'];
      else {
        validated = validateReview(parsed, { sourceCount: sources.length });
        problems = validated.problems;
      }
      if (!problems.length) break;
      message = buildRetryPrompt(user, problems);
      sentRetry = message.slice(user.length);
    }
  } finally {
    // the tokens were spent whether or not the answer was usable
    if (inputTokens || outputTokens) deps.logUsage({ userId, model, inputTokens, outputTokens, feature: 'topic_research_review' });
  }
  report.done('write');
  report.start('check', 'Checking the answer');
  if (problems.length) throw fail(502, 'The AI model\'s answer could not be used, even after a second try. Try again, or choose a different model for this step in Settings.');
  const costUsd = deps.calculateCost(model, inputTokens, outputTokens);
  report.done('check', `${validated.value.structure.length} sections recommended`);
  return { review: validated.value, dropped: validated.dropped, model, inputTokens, outputTokens, costUsd, attempts, prompt: { model, system, user, retry: sentRetry } };
}

module.exports = { generateReview, MAX_OUTPUT_TOKENS, TIMEOUT_MS };
