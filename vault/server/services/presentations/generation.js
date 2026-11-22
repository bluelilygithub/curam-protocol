'use strict';

// Prompt plumbing for Presentations. Only two model calls are needed: the same resolved text model makes
// the outline and the deck. The route-validated selection (or default_model) wins; tier ids are fallbacks
// from Settings via getModelsForUser(). No model id is hard-coded here.

const { normalizeDeck, normalizeOutline, normalizeSlide, deckFromOutline, text, SOURCE_MAX, LAYOUTS, PresentationError } = require('./schema');

// What each layout is for, so the model picks a fitting one per slide (geometry: layouts.js).
const LAYOUT_GUIDE = [
  'title: the first slide (title + body as the subtitle).',
  'section: a divider between parts of the talk (title + optional body).',
  'bullets: a heading and up to 5 points.',
  'agenda: a numbered list of what the talk covers (bullets).',
  'two-column: a paragraph (body) beside points (bullets).',
  'comparison: two options side by side: columns = [{ heading, bullets }, { heading, bullets }].',
  'three-column: three ideas, steps or features: columns = three { heading, bullets }.',
  'stats: two to four key numbers: columns = [{ heading: "42%", bullets: ["what it measures"] }, ...]. Only numbers found in the material.',
  'quote: a quotation in body, and who said it in title.',
  'timeline: dated milestones in order: bullets like "2024 — Launched in Brisbane".',
  'picture: an image (imageRef) beside points or a paragraph.',
  'full-picture: one image filling the slide, with a short title on it.',
  'closing: the last slide (thanks, next steps or questions).',
];
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

function outlinePrompt({ brief, sourceText, imageRefs, controls = {} }) {
  const source = text(sourceText, SOURCE_MAX);
  const images = Array.isArray(imageRefs) ? imageRefs.slice(0, 8).map((r) => text(r, 500)).filter(Boolean) : [];
  const wanted = Number(controls.nSlides) >= 6 && Number(controls.nSlides) <= 20 ? Math.round(Number(controls.nSlides)) : null;
  return {
    system: 'You plan short, useful slide decks. Reply with ONLY minified JSON. No markdown, no commentary. Keep language plain. Never invent facts that are not in the supplied material; when the material is thin, structure what is there instead of padding it.',
    user: JSON.stringify({
      task: 'Make a slide-by-slide outline for the deck described below.',
      brief: text(brief, 4000),
      sourceText: source || null,
      availableImages: images.length ? images : null,
      controls: {
        nSlides: wanted,
        audience: text(controls.audience, 160) || null,
        tone: text(controls.tone, 80) || null,
        durationMinutes: Number(controls.duration) || null,
      },
      rules: [
        wanted ? `Return exactly ${wanted} slides.` : 'Return 6 to 12 slides.',
        'Each slide: { layout, title, bullets, body, columns, imageRef, imagePrompt, notes }.',
        `layout must be one of: ${LAYOUTS.join(', ')}. Pick the one that fits the content, and vary them; do not make every slide bullets.`,
        ...LAYOUT_GUIDE,
        'bullets is an array of at most 5 short strings. Use [] when a layout does not use them. columns is [] unless the layout uses it.',
        'Use picture or full-picture only when an imageRef from availableImages fits; never invent images or numbers.',
        'imageRef must be one of availableImages, or an empty string. For other slides, imagePrompt may describe a simple placeholder illustration; leave it empty where a picture would not help.',
        'notes is one useful sentence the presenter could say, or an empty string.',
        'The first slide should be layout "title" and the last "closing".',
        'Also return { title, subtitle, nSlides, aspect, audience, tone, duration } at the top level, repeating the supplied controls.',
      ],
    }),
  };
}

function slidesPrompt({ outline, theme, controls = {} }) {
  return {
    system: 'You write presentation slides. Reply with ONLY minified JSON. No markdown. Use the supplied outline exactly: do not add new claims or slides. Write concise sentences that fit on a slide.',
    user: JSON.stringify({
      outline,
      theme: { id: theme.id, label: theme.label, font: theme.font },
      controls: {
        audience: text(controls.audience || outline.audience, 160) || null,
        tone: text(controls.tone || outline.tone, 80) || null,
        durationMinutes: Number(controls.duration || outline.duration) || null,
      },
      rules: [
        'Return { title, subtitle, themeId, aspect, audience, tone, duration, nSlides, slides }.',
        'Use the same number of slides and the same ids as the outline (s1, s2, ...).',
        'Each slide: { id, layout, title, bullets, body, columns, imageRef, imagePrompt, notes }. Keep each slide\'s layout from the outline.',
        'columns is an array of { heading, bullets } (headings at most 60 characters, at most 4 bullets each), used by comparison, three-column and stats; [] otherwise.',
        'At most 6 bullets of at most 200 characters each; body at most 600 characters; notes at most 400 characters.',
        'Keep imageRef and imagePrompt exactly as supplied in the outline, or empty.',
        'Write notes that suit the audience and tone, and keep the talk within the duration.',
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

/** Make a clamped outline. Uses the same validated selection/default as the slides; tiers are only fallbacks. */
async function generateOutline({ userId, brief, sourceText = '', imageRefs = [], controls = {}, model, deps = {} }) {
  const getModels = getResolver(deps);
  const models = model ? {} : await getModels(userId);
  const modelId = model || models.standard || models.light;
  if (!modelId) {
    throw Object.assign(new Error('No AI model is set up for this workspace. Add a model in Settings.'), { status: 503 });
  }
  const request = { nSlides: controls.nSlides, audience: controls.audience, tone: controls.tone, duration: controls.duration };
  const raw = await callJson(modelId, outlinePrompt({ brief, sourceText, imageRefs, controls: request }), {
    maxTokens: 2200,
    feature: 'presentations_outline',
    userId,
    deps,
  });
  return normalizeOutline({ ...raw, ...request });
}

/** Expand an outline into the canonical deck. The route may pass a validated selection; tiers remain the fallback. */
async function generateDeck({ userId, outline, theme, designId = 'clean', model, deps = {} }) {
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
    return normalizeDeck({
      ...raw,
      themeId: theme.id,
      designId,
      aspect: raw.aspect || outline.aspect,
      audience: raw.audience || outline.audience,
      tone: raw.tone || outline.tone,
      duration: raw.duration || outline.duration,
      nSlides: raw.nSlides || outline.nSlides || (raw.slides || []).length,
      outline: Array.isArray(raw.outline) && raw.outline.length ? raw.outline : outline.slides,
    });
  } catch (err) {
    // A schema slip in a model answer must not lose the whole job. The outline is still good.
    // A provider/key failure is different: show it plainly instead of silently writing a fallback deck.
    if (err?.code === 'model_call') throw err;
    return deckFromOutline(outline, theme.id, designId);
  }
}

function rewriteSlidePrompt({ deck, index, instruction }) {
  return {
    system: 'You edit ONE slide of an existing presentation. Reply with ONLY minified JSON. Keep the same layout, do not add slides, and never invent facts that are not in the deck or the instruction.',
    user: JSON.stringify({
      deckTitle: deck.title,
      audience: deck.audience || null,
      tone: deck.tone || null,
      duration: deck.duration || null,
      neighbouringSlides: [deck.slides[index - 1]?.title, deck.slides[index + 1]?.title].filter(Boolean),
      slide: deck.slides[index],
      instruction: text(instruction, 600),
      rules: [
        'Return { layout, title, bullets, body, columns, imageRef, imagePrompt, notes }.',
        'Keep the layout from the supplied slide. Change only what the instruction asks for.',
        'At most 6 bullets, at most 200 characters each; body and notes at most 600 characters.',
        'Keep imageRef and imagePrompt unchanged unless the instruction asks for a different picture.',
      ],
    }),
  };
}

/** Regenerate one slide in place. A malformed model answer leaves the original slide untouched with a warning. */
async function rewriteSlide({ userId, deck: input, index, instruction, model, deps = {} }) {
  const deck = normalizeDeck(input);
  const at = Number(index);
  if (!Number.isInteger(at) || at < 0 || at >= deck.slides.length) throw new PresentationError('That slide is not in this deck.', 400);
  const request = text(instruction, 600);
  if (!request) throw new PresentationError('Say what should change on this slide.', 400);
  const getModels = getResolver(deps);
  const models = model ? {} : await getModels(userId);
  const modelId = model || models.standard || models.light;
  if (!modelId) throw Object.assign(new Error('No AI model is set up for this workspace. Add a model in Settings.'), { status: 503 });
  const original = deck.slides[at];
  try {
    const raw = await callJson(modelId, rewriteSlidePrompt({ deck, index: at, instruction: request }), {
      maxTokens: 2200,
      feature: 'presentations_rewrite',
      userId,
      deps,
    });
    return { slide: normalizeSlide({ ...original, ...raw, id: original.id, layout: original.layout }, at), warning: null };
  } catch (err) {
    if (err?.code === 'presentations_parse') return { slide: original, warning: 'The model answer could not be read; the slide was left as it was.' };
    throw err;
  }
}

module.exports = {
  generateOutline, generateDeck, rewriteSlide, outlinePrompt, slidesPrompt, rewriteSlidePrompt, parseJson, SOURCE_MAX,
};
