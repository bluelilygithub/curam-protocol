'use strict';

// Slideshow "describe the video" planner. The user describes the look/feel in plain English;
// a light-tier model turns that into a structured plan (order, per-slide timing + captions,
// transition, camera motion, colour mood). The plan is returned for the user to review/edit,
// then sent back to POST /api/videos/slideshow, which re-validates it with
// normalizeSlideshowPlan() — the model's output and the client's edits are both untrusted.
//
// The model only sees the description + file names, never the pixels (callModel is text-only),
// so the UI says so and lets the user reorder/edit before building.

const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');

const ASPECTS = ['9:16', '16:9', '1:1', '4:5'];
const MODES = ['crop', 'pad'];
// ffmpeg xfade transition names — 'cut' means a hard cut (no xfade).
const TRANSITIONS = ['cut', 'fade', 'dissolve', 'fadeblack', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'zoomin'];
const MOTIONS = ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'mixed'];
const MOODS = ['none', 'warm', 'cool', 'vivid', 'mono', 'vintage', 'cinematic'];
const CAPTION_POSITIONS = ['bottom-center', 'top-center', 'center'];

const MAX_IMAGES = 20;
const MAX_CAPTION_CHARS = 80;
const MIN_SLIDE_SEC = 1;
const MAX_SLIDE_SEC = 15;
const MAX_TOTAL_SEC = 180;

function pick(value, allowed, fallback) {
  const v = String(value ?? '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function cleanCaption(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CAPTION_CHARS);
}

/**
 * Validate + clamp an untrusted plan. Every uploaded image appears exactly once: invalid or
 * duplicate indices are dropped, images the plan forgot are appended in upload order.
 * Always returns a usable plan, even for `raw = null`.
 */
function normalizeSlideshowPlan(raw, imageCount, defaults = {}) {
  const count = Math.max(0, Math.min(MAX_IMAGES, Number(imageCount) || 0));
  const src = raw && typeof raw === 'object' ? raw : {};
  const defaultSec = clampNum(defaults.secondsPerSlide ?? src.secondsPerSlide, MIN_SLIDE_SEC, MAX_SLIDE_SEC, 3);

  const seen = new Set();
  const slides = [];
  for (const s of Array.isArray(src.slides) ? src.slides : []) {
    const index = Number(s?.index);
    if (!Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) continue;
    seen.add(index);
    slides.push({
      index,
      durationSec: clampNum(s?.durationSec, MIN_SLIDE_SEC, MAX_SLIDE_SEC, defaultSec),
      caption: cleanCaption(s?.caption),
    });
  }
  for (let i = 0; i < count; i += 1) {
    if (!seen.has(i)) slides.push({ index: i, durationSec: defaultSec, caption: '' });
  }

  // Keep the whole video bounded no matter what the model/client asked for.
  const total = slides.reduce((sum, s) => sum + s.durationSec, 0);
  if (total > MAX_TOTAL_SEC) {
    const scale = MAX_TOTAL_SEC / total;
    slides.forEach((s) => { s.durationSec = Math.max(MIN_SLIDE_SEC, Math.round(s.durationSec * scale * 10) / 10); });
  }

  const transition = pick(src.transition, TRANSITIONS, 'cut');
  return {
    aspect: pick(src.aspect ?? defaults.aspect, ASPECTS, '9:16'),
    mode: pick(src.mode ?? defaults.mode, MODES, 'pad'),
    transition,
    transitionSec: transition === 'cut' ? 0 : clampNum(src.transitionSec, 0.2, 2, 0.6),
    motion: pick(src.motion, MOTIONS, 'none'),
    mood: pick(src.mood, MOODS, 'none'),
    captionPosition: pick(src.captionPosition, CAPTION_POSITIONS, 'bottom-center'),
    slides,
    summary: cleanCaption(src.summary).slice(0, 300),
  };
}

const PLANNER_SYSTEM = `You plan short slideshow videos built from still images with ffmpeg.
You cannot see the images — only the user's description and the image file names. Never invent what a picture shows; only add a caption when the description gives you the words or the file name clearly says what it is.
Return ONLY valid JSON, no markdown fences.`;

function buildPlannerPrompt(description, images, hasAudio) {
  const list = images.map((img, i) => `${i}: ${String(img.name || `image ${i + 1}`).slice(0, 80)}`).join('\n');
  return `Description of the video the user wants:
"""${String(description).slice(0, 1500)}"""

Images (index: file name):
${list}

Background music supplied: ${hasAudio ? 'yes' : 'no'}

Choose settings. Allowed values:
- aspect: ${ASPECTS.join(' | ')} (9:16 for reels/stories, 16:9 for YouTube/landscape, 1:1 square, 4:5 portrait feed)
- mode: "crop" (fill the frame, trims edges) | "pad" (whole image visible with bars)
- transition: ${TRANSITIONS.join(' | ')}
- transitionSec: 0.2-2
- motion (slow camera move on every still): ${MOTIONS.join(' | ')}
- mood (colour grade): ${MOODS.join(' | ')}
- captionPosition: ${CAPTION_POSITIONS.join(' | ')}
- slides: array in PLAY ORDER, every image index exactly once, each { "index": n, "durationSec": ${MIN_SLIDE_SEC}-${MAX_SLIDE_SEC}, "caption": "" (max ${MAX_CAPTION_CHARS} chars, empty unless wanted) }
Match pacing to the description (energetic = short slides ~1.5-2.5s, calm/elegant = 4-6s). Keep total under ${MAX_TOTAL_SEC}s.

Return JSON:
{"summary":"one sentence on the look you chose and why","aspect":"","mode":"","transition":"","transitionSec":0.6,"motion":"","mood":"","captionPosition":"","slides":[{"index":0,"durationSec":3,"caption":""}]}`;
}

/**
 * @param {number} userId
 * @param {{ description: string, images: Array<{name?: string}>, hasAudio?: boolean }} input
 */
async function planSlideshow(userId, { description, images, hasAudio = false }) {
  const desc = String(description || '').trim();
  if (!desc) throw new Error('Describe the video you want first');
  if (!Array.isArray(images) || images.length < 2) throw new Error('Add at least two images first');
  if (images.length > MAX_IMAGES) throw new Error(`Maximum ${MAX_IMAGES} images`);

  const { light: modelId } = await getModelsForUser(userId);
  const result = await callModel(modelId, buildPlannerPrompt(desc, images, hasAudio), {
    system: PLANNER_SYSTEM,
    maxTokens: 1800,
    returnUsage: true,
    timeoutMs: 45000,
  });
  logUsage({
    userId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature: 'videos',
  });

  const parsed = parseModelJson(String(result.text || '').trim());
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The planner returned something unreadable — try rewording your description.');
  }
  return normalizeSlideshowPlan(parsed, images.length);
}

module.exports = {
  planSlideshow,
  normalizeSlideshowPlan,
  buildPlannerPrompt,
  ASPECTS,
  MODES,
  TRANSITIONS,
  MOTIONS,
  MOODS,
  CAPTION_POSITIONS,
  MAX_IMAGES,
};
