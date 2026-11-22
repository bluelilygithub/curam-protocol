'use strict';

// Best-effort, low-cost placeholder pictures for a new deck or a newly added slide.
// Uses the Graphics image router with a small fixed size and a dedicated usage feature. If that provider is not
// configured, the deck still builds — a warning is returned instead of a broken picture reference.

const { text, normalizeDeck } = require('./schema');
const { saveAsset } = require('./sources');

const DEFAULT_PER_DECK = 3;
const MAX_PER_DECK = 20;
const WIDTH = 768;
const HEIGHT = 512;

function limitForDeck(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PER_DECK;
  return Math.max(0, Math.min(MAX_PER_DECK, Math.round(n)));
}

function placeholderPrompt({ deck, slide, index }) {
  const subject = text(slide?.imagePrompt, 300) || text(slide?.title, 120) || text(deck?.title, 160) || 'the presentation topic';
  return `Simple editorial placeholder illustration for a presentation slide about ${subject}. `
    + 'Flat vector style, generous empty space, restrained colours, no words, no letters, no logos, no people’s faces, 16:9 composition.';
}

function dataUrlToImage(dataUrl) {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  const ext = match[1].toLowerCase() === 'jpeg' || match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  return { mime: `image/${ext}`, buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64') };
}

/** Generate one owned asset ref. Never throws for an unavailable image provider. */
async function makePlaceholder({ userId, deck, slide, index = 0, deps = {} }) {
  const generate = deps.generateImage || require('../graphicsImageService').generateImage;
  const store = deps.saveAsset || saveAsset;
  const prompt = placeholderPrompt({ deck, slide, index });
  let out;
  try {
    out = await generate(userId, { prompt, width: WIDTH, height: HEIGHT, feature: 'presentations_placeholder' });
  } catch (err) {
    return { imageRef: '', warning: `Placeholder pictures are unavailable: ${text(err?.message, 160) || 'image provider error'}` };
  }
  if (!out?.ok || !out.imageDataUrl) {
    return { imageRef: '', warning: out?.error ? `Placeholder pictures were skipped: ${text(out.error, 160)}` : '' };
  }
  const image = dataUrlToImage(out.imageDataUrl);
  if (!image || !image.buffer.length) return { imageRef: '', warning: 'The placeholder picture could not be saved.' };
  try {
    const imageRef = await store(userId, image.buffer, image.mime, deps);
    return { imageRef, warning: '' };
  } catch {
    return { imageRef: '', warning: 'The placeholder picture could not be saved.' };
  }
}

/** Attach cheap placeholders to a freshly generated deck. Returns the deck plus a short warning if any failed. */
async function addDeckPlaceholders({ userId, deck: input, limit, deps = {}, onProgress = () => {} }) {
  const deck = normalizeDeck(input);
  const total = limitForDeck(limit ?? process.env.PRESENTATIONS_PLACEHOLDERS_PER_DECK);
  if (!total) return { deck, warning: '' };
  const ranked = deck.slides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => !slide.imageRef && !slide.images?.length)
    .sort((a, b) => {
      const score = (x) => (x.slide.imagePrompt ? 4 : 0) + (['picture', 'full-picture'].includes(x.slide.layout) ? 3 : 0) + (['title', 'closing'].includes(x.slide.layout) ? -2 : 0);
      return score(b) - score(a) || a.index - b.index;
    })
    .slice(0, total);
  if (!ranked.length) return { deck, warning: '' };

  const slides = deck.slides.map((s) => ({ ...s, images: [...(s.images || [])], shapes: [...(s.shapes || [])] }));
  const warnings = [];
  let done = 0;
  for (const { slide, index } of ranked) {
    // eslint-disable-next-line no-await-in-loop
    const result = await makePlaceholder({ userId, deck, slide, index, deps });
    done += 1;
    onProgress(75 + Math.round((done / ranked.length) * 20), 'Adding placeholder pictures');
    if (!result.imageRef) {
      if (result.warning) warnings.push(result.warning);
      continue;
    }
    if (['picture', 'full-picture'].includes(slide.layout)) slides[index].imageRef = result.imageRef;
    else slides[index].images.push({
      id: `placeholder-${index + 1}`,
      ref: result.imageRef,
      x: 61, y: 54, w: 34, h: 34, fit: 'contain',
    });
  }
  const unique = [...new Set(warnings)].slice(0, 2);
  return { deck: { ...deck, slides }, warning: unique.join(' ') };
}

module.exports = {
  DEFAULT_PER_DECK, MAX_PER_DECK, WIDTH, HEIGHT, limitForDeck, placeholderPrompt, dataUrlToImage, makePlaceholder, addDeckPlaceholders,
};
