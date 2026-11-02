'use strict';

// The three things the Guitar coach asks a model to write, each checked before anyone sees it (see guitarCoach.js). A model that is not
// set up, fails, or writes something that does not pass the check gives the plain template wording instead (the explanation, which
// has no template, says so). The model is the workspace's, never a hardcoded id. Its output is always treated as untrusted.

const coach = require('./guitarCoach');
const { extractJson } = require('./guideCore');

/** One model call that must answer in JSON. Returns the parsed object, or null when there is no usable answer. */
async function askJson(userId, { tier, system, prompt, feature, maxTokens }, deps = {}) {
  const resolve = deps.getModels || require('./modelResolver').getModelsForUser;
  const call = deps.callModel || require('./callModel').callModel;
  let tiers;
  try { tiers = await resolve(userId); } catch { return null; }
  const modelId = tier === 'light' ? (tiers.light || tiers.standard) : tiers.standard;
  if (!modelId) return null;
  let result;
  try {
    result = await call(modelId, prompt, { system, maxTokens: maxTokens || 700, returnUsage: true, timeoutMs: 45000 });
  } catch { return null; }
  (deps.logUsage || require('../utils/logUsage').logUsage)({
    userId, model: result.model || modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature,
  });
  const parsed = extractJson(String(result.text || ''));
  return parsed && typeof parsed === 'object' ? parsed : null;
}

async function weeklyReview(userId, facts, deps) {
  const template = coach.reviewTemplate(facts);
  if (facts.empty) return { text: template, source: 'rules' };
  const out = await askJson(userId, { tier: 'light', system: coach.REVIEW_SYSTEM, prompt: coach.reviewPrompt(facts), feature: 'guitar_coach_review', maxTokens: 400 }, deps);
  const text = out && typeof out.review === 'string' ? out.review.replace(/\s+/g, ' ').trim().slice(0, 700) : '';
  if (text && coach.numbersAreKnown(text, coach.allowedNumbers(facts))) return { text, source: 'ai' };
  return { text: template, source: 'rules' };
}

async function sessionWords(userId, plan, focusText, deps) {
  if (!plan.blocks.length) return { ...coach.sessionTemplate(plan), source: 'rules' };
  const out = await askJson(userId, { tier: 'light', system: coach.SESSION_SYSTEM, prompt: coach.sessionPrompt(plan, focusText), feature: 'guitar_coach_session', maxTokens: 600 }, deps);
  const words = coach.checkSessionWords(out, plan);
  return words ? { ...words, source: 'ai' } : { ...coach.sessionTemplate(plan), source: 'rules' };
}

/** Returns the checked explanation, or null when there is no model or it did not pass the check. */
async function explainSong(userId, facts, deps) {
  const out = await askJson(userId, { tier: 'standard', system: coach.EXPLAIN_SYSTEM, prompt: coach.explainPrompt(facts), feature: 'guitar_coach_explain', maxTokens: 900 }, deps);
  return coach.checkExplanation(out, facts);
}

module.exports = { askJson, weeklyReview, sessionWords, explainSong };
