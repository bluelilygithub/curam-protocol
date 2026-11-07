'use strict';

// "Let the AI look" for the Slideshow and Join planners (Video Tools). Until 8 Nov 2026 the planners worked from the description and the FILE NAMES only.
// Now, when the person ticks the box, the BROWSER sends a few small JPEG copies (one picture per slide, two frames per clip, at most 512 px) and the
// planner is shown them with the description. Nothing is sent unless the box is ticked. The footage and the original pictures never leave the browser.
//
// Why small copies from the browser and not the files: no video upload just to plan (up to 12 x 80 MB), no ffmpeg run, and the server holds only a
// couple of megabytes. Everything the browser sends is untrusted: it is checked here (a real JPEG, its size, how many, the total) and the model's answer
// is validated again by the planners' normalize functions. What is IN the pictures is treated as content, never as instructions.
//
// The cost is estimated BEFORE anything is sent (GET /api/videos/vision-info gives the price per picture) and the server refuses a plan whose estimate
// is over VIDEO_VISION_MAX_USD (default US$0.25). Pure helpers; the model and the price table are passed in so tests need no network.
// See docs/video-tools.md, "Let the AI look".

const { calculateCost } = require('./costCalculator');

const MAX_VISION_FRAMES = 24; // all pictures in one plan
const MAX_FRAME_CHARS = 140000; // one picture as base64 (about 105 KB: a 512 px JPEG is normally 20 to 60 KB)
const MAX_TOTAL_CHARS = 2400000; // all pictures together (about 1.8 MB)
const MAX_PX = 512; // the longest side the browser is asked to send
const TOKENS_PER_FRAME = 450; // a deliberately high estimate for a picture up to 512 px (Claude counts about width x height / 750, Gemini about 260)
const PLAN_TEXT_TOKENS = 1500; // the prompt text
const PLAN_OUTPUT_TOKENS = 1200; // the answer
const DEFAULT_MAX_USD = 0.25;

class VisionInputError extends Error {
  constructor(message) { super(message); this.name = 'VisionInputError'; }
}

const maxUsd = (env = process.env) => {
  const n = Number(env.VIDEO_VISION_MAX_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_USD;
};

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** One picture from the browser -> a clean base64 string, or a plain-words error. Must be a JPEG (every JPEG starts with the bytes FF D8 FF = "/9j/"). */
function cleanFrame(raw) {
  if (typeof raw !== 'string' || !raw) throw new VisionInputError('A picture sent for the AI to look at was empty.');
  const s = raw.replace(/^data:image\/jpe?g;base64,/i, '');
  if (s.length > MAX_FRAME_CHARS) throw new VisionInputError('A picture sent for the AI to look at was too big. The page sends small copies, so try reloading it.');
  if (!B64.test(s) || !s.startsWith('/9j/')) throw new VisionInputError('A picture sent for the AI to look at was not a JPEG.');
  return s;
}

/**
 * The pictures that came with a plan request. `items` are the slides or clips as sent ({ name, frames: [base64] }); `perItem` is the most pictures
 * one slide or clip may bring (1 for a slide, 3 for a clip). @returns {{ images, counts, total }} images in the order the prompt will list them
 */
function collectFrames(items, { perItem }) {
  const images = [];
  const counts = [];
  let chars = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const frames = Array.isArray(item && item.frames) ? item.frames.slice(0, perItem) : [];
    const clean = frames.map(cleanFrame);
    for (const data of clean) { images.push({ mimeType: 'image/jpeg', data }); chars += data.length; }
    counts.push(clean.length);
  }
  if (images.length > MAX_VISION_FRAMES) throw new VisionInputError(`Too many pictures for one plan (at most ${MAX_VISION_FRAMES}). Use fewer slides or clips, or leave the AI look off.`);
  if (chars > MAX_TOTAL_CHARS) throw new VisionInputError('The pictures together were too big for one plan. Reload the page and try again.');
  return { images, counts, total: images.length };
}

/** The AI model for a plan that has pictures: the light one, unless it cannot take pictures (local or DeepSeek), then the standard one. */
function pickVisionModel(models) {
  const can = (id) => typeof id === 'string' && id && !/^(ollama:|deepseek-)/.test(id);
  if (can(models && models.light)) return models.light;
  if (can(models && models.standard)) return models.standard;
  throw new VisionInputError('None of the AI models set up for this workspace can look at pictures. Choose a Claude or Gemini model in Settings, or leave the AI look off.');
}

/** What a plan with `frames` pictures is expected to cost on `modelId` (an estimate from the price table: the real cost is logged afterwards). */
function estimateVisionUsd(modelId, frames) {
  return calculateCost(modelId, PLAN_TEXT_TOKENS + frames * TOKENS_PER_FRAME, PLAN_OUTPUT_TOKENS);
}

/** Refuse a plan whose estimate is over the limit, before anything is sent to the model. */
function assertWithinBudget(modelId, frames, env = process.env) {
  const est = estimateVisionUsd(modelId, frames);
  const cap = maxUsd(env);
  if (est > cap) throw new VisionInputError(`This plan would cost about US$${est.toFixed(3)}, over the limit of US$${cap.toFixed(2)} for one plan. Use fewer pictures or leave the AI look off.`);
  return est;
}

/** For the page, before anything is sent: the model, the price of one picture and the limits. */
async function visionInfo(userId, { getModels, env = process.env } = {}) {
  const models = await getModels(userId);
  let model = null;
  let usdPerFrame = null;
  let problem = null;
  try {
    model = pickVisionModel(models);
    usdPerFrame = calculateCost(model, TOKENS_PER_FRAME, 0);
  } catch (err) { problem = err.message; }
  return { available: Boolean(model), problem, model, usdPerFrame, planBaseUsd: model ? estimateVisionUsd(model, 0) : null, maxFrames: MAX_VISION_FRAMES, maxPx: MAX_PX, maxUsd: maxUsd(env) };
}

/** The lines that tell the model which picture is which, in the order the pictures are attached. `what` is "slide" or "clip". */
function describePictures(names, counts, what) {
  const lines = [];
  let n = 1;
  counts.forEach((count, i) => {
    if (!count) return;
    const label = `${what} index ${i}${names[i] ? ` ("${String(names[i]).replace(/["\n\r]/g, ' ').slice(0, 60)}")` : ''}`;
    const list = Array.from({ length: count }, () => `picture ${n++}`).join(', ');
    lines.push(`- ${label}: ${list}`);
  });
  return lines.join('\n');
}

module.exports = {
  VisionInputError, cleanFrame, collectFrames, pickVisionModel, estimateVisionUsd, assertWithinBudget, visionInfo, describePictures, maxUsd,
  MAX_VISION_FRAMES, MAX_FRAME_CHARS, MAX_TOTAL_CHARS, MAX_PX, TOKENS_PER_FRAME, DEFAULT_MAX_USD,
};
