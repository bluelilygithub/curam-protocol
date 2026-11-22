'use strict';

// Prompt plumbing for Presentations. Only two model calls are needed: a light model makes the outline,
// the standard model (or a route-validated selection) expands it into the canonical deck. Tier ids come
// from Settings via getModelsForUser(); no model id is hard-coded here.

const { normalizeDeck, normalizeOutline, deckFromOutline, text, SOURCE_MAX } = require('./schema');
const { modelCallError } = require('../../utils/modelCallError');

// The model and usage modules open a database connection when loaded, so they are only loaded when a real call is made. Direct
// tests inject all three through `deps` and never touch Postgres.
const getResolver = (deps) => deps.getModelsForUser || require('../modelResolver').getModelsForUser;

function parseJson(answer) {
  const raw = typeof answer === 'string' ? answer : answer?.text || answer?.content || '';
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) {
    throw Object.assign(new Error('No JSON object in model answer'), { code: 'presentations_parse' });
  }
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch (err) {
    throw Object.assign(new Error('Model answer was not valid JSON'), { code: 'presentations_parse', cause: err });
  }
}

function outlinePrompt({ brief, sourceText, imageRefs }) {
  const source = text(sourceText, SOURCE_MAX);
  const images = Array.isArray(imageRefs) ? imageRefs.slice(0, 8).map((r) => text(r, 500)).filter(Boolean) : [];
  return {
    system: 'You plan short, useful slide decks. Reply with ONLY minified JSON. No markdown, no commentary. Keep language plain. Never invent facts that are not in the supplied material; when the material is thin, structure what is there instead of padding it.',
    user: JSON.stringify({
      task: 'Make a slide-by-slide outline for the deck described below.',
      brief: text(brief, 4000),
      sourceText: source || null,
      availableImages: images.length ? images : null,
      rules: [
        'Return 6 to 12 slides.',
        'Each slide: { layout, title, bullets, body, imageRef }.',
        'layout must be one of: title, bullets, two-column, picture, closing.',
        'bullets is an array of at most 5 short strings. Use [] for title and picture slides.',
        'imageRef must be one of availableImages, or an empty string.',
        'The first slide should be layout "title" and the last "closing".',
        'Also return { title, subtitle, nSlides, aspect } at the top level.',
      ],
    }),
  };
}

function slidesPrompt({ outline, theme }) {
  return {
    system: 'You write presentation slides. Reply with ONLY minified JSON. No markdown. Use the supplied outline exactly: do not add new claims or slides. Write concise sentences that fit on a slide.',
    user: JSON.stringify({
      outline,
      theme: { id: theme.id, label: theme.label, font: theme.font },
      rules: [
        'Return { title, subtitle, themeId, aspect, slides }.',
        'Use the same number of slides and the same ids as the outline (s1, s2, ...).',
        'Each slide: { id, layout, title, bullets, body, imageRef, notes }.',
        'At most 6 bullets of at most 200 characters each; body at most 600 characters; notes at most 400 characters.',
        'Keep imageRef exactly as supplied in the outline, or empty.',
      ],
    }),
  };
}

async function callJson(modelId, prompt, { maxTokens = 2400, feature, userId, deps }) {
  const invoke = deps.callModel || require('../callModel').callModel;
  const record = deps.logUsage || require('../../utils/logUsage').logUsage;
  let out;
  try {
    out = await invoke(modelId, prompt.user, {
      system: prompt.system,
      maxTokens,
      returnUsage: true,
      signal: deps.signal || null,
    });
  } catch (err) {
    throw modelCallError(err, modelId);
  }
  const answer = typeof out === 'string' ? out : out.text;
  await record({
    userId,
    model: out?.model || modelId,
    inputTokens: out?.inputTokens,
    outputTokens: out?.outputTokens,
    feature,
  });
  return parseJson(answer);
}

/** Make a clamped outline. A malformed model answer throws a plain 502. */
async function generateOutline({ userId, brief, sourceText = '', imageRefs = [], deps = {} }) {
  const getModels = getResolver(deps);
  const models = await getModels(userId);
  const modelId = models.light || models.standard;
  if (!modelId) {
    throw Object.assign(new Error('No AI model is set up for this workspace. Add a model in Settings.'), { status: 503 });
  }
  const raw = await callJson(modelId, outlinePrompt({ brief, sourceText, imageRefs }), {
    maxTokens: 2200,
    feature: 'presentations_outline',
    userId,
    deps,
  });
  return normalizeOutline(raw);
}

/** Expand an outline into the canonical deck. The route may pass a validated selection; tiers remain the fallback. */
async function generateDeck({ userId, outline, theme, model, deps = {} }) {
  const getModels = getResolver(deps);
  const models = model ? {} : await getModels(userId);
  const modelId = model || models.standard || models.light;
  if (!modelId) {
    throw Object.assign(new Error('No AI model is set up for this workspace. Add a model in Settings.'), { status: 503 });
  }
  let raw;
  try {
    raw = await callJson(modelId, slidesPrompt({ outline, theme }), {
      maxTokens: 6000,
      feature: 'presentations_deck',
      userId,
      deps,
    });
    return normalizeDeck({ ...raw, themeId: theme.id, aspect: raw.aspect || outline.aspect });
  } catch (err) {
    // A schema slip in a model answer must not lose the whole job. The outline is still good.
    // A provider/key failure is different: show it plainly instead of silently writing a fallback deck.
    if (err?.code === 'model_call') throw err;
    return deckFromOutline(outline, theme.id);
  }
}

module.exports = { generateOutline, generateDeck, outlinePrompt, slidesPrompt, parseJson, SOURCE_MAX };
