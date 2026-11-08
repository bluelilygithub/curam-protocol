'use strict';

// Sketchbook's connection to the image provider. It reuses the Graphics generation core (same model choice, same keys, same content
// restrictions and the same spend log), so Sketchbook adds no new provider setup. The routes call these two functions BY PROPERTY
// (engine.draw / engine.change) so a test can swap them for stand-ins.
//
//   draw({ userId, prompt, width, height })       -> { imageDataUrl, seed, model, costUsd }   a new picture from words
//   change({ userId, prompt, imageDataUrl })      -> { imageDataUrl, seed, model, costUsd }   the same picture, changed by words
//   thumbnail(imageDataUrl)                       -> small JPEG data URL for the list, or null
//   normalise(imageDataUrl)                       -> the picture re-encoded as a JPEG no bigger than 1024px, as a data URL
//
// Changing a picture uses an instruction-following edit model on the hosted site (FAL, env SKETCHBOOK_EDIT_MODEL, default
// fal-ai/flux-kontext/dev). On a local copy it uses ComfyUI image-to-image, which can only nudge a picture, not follow an exact instruction.

const { randomUUID } = require('crypto');
const sharp = require('sharp');
const g = require('../routes/graphics/shared');

const EDIT_MODEL_DEFAULT = 'fal-ai/flux-kontext/dev';
const FEATURE = 'graphics_sketchbook'; // starts with graphics_ so it shows on the Usage dashboard and counts towards the daily image limit
const NEGATIVE = 'photograph, photorealistic, 3d render, text, lettering, caption, watermark, signature, blurry, deformed hands, extra limbs';

const newSeed = () => Math.floor(Math.random() * 2147483647);

function editCostUsd() {
  const n = Number(process.env.SKETCHBOOK_EDIT_COST_USD);
  return Number.isFinite(n) && n > 0 ? n : 0.03;
}

/** The price of one picture or one change, as the Graphics tools estimate it (0 on a local copy). */
async function price(userId, kind) {
  const model = await g.resolveGraphicsModel(userId);
  const provider = await g.resolveGraphicsProvider(userId, model);
  if (provider === 'local-comfyui') return { usd: 0, local: true, provider };
  if (kind === 'change') return { usd: editCostUsd(), estimate: true, provider };
  return { ...g.estimateGenerateCost({ provider }), provider };
}

async function editWithFal({ prompt, imageDataUrl, seed }) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY is not configured');
  const endpoint = String(process.env.SKETCHBOOK_EDIT_MODEL || EDIT_MODEL_DEFAULT).replace(/^https:\/\/fal\.run\//, '').replace(/^\/+/, '');
  const data = await g.fetchJson(`https://fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_url: imageDataUrl, num_images: 1, sync_mode: true, enable_safety_checker: true, output_format: 'jpeg', seed }),
  });
  const image = Array.isArray(data.images) ? data.images[0] : null;
  if (!image?.url) throw new Error('The image service did not return a changed picture');
  return { imageDataUrl: await g.imageUrlToDataUrl(image.url, image.content_type), seed: Number.isFinite(Number(data.seed)) ? Number(data.seed) : seed, model: endpoint };
}

async function comfyRun(workflow) {
  const queued = await g.fetchJson(`${g.comfyBaseUrl()}/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
  });
  const image = await g.waitForImage(queued.prompt_id);
  return g.loadImageDataUrl(image);
}

async function draw({ userId, prompt, width, height }) {
  const restrictions = await g.loadContentRestrictions();
  g.assertPromptAllowed(prompt, restrictions);
  const negativePrompt = g.buildNegativePrompt(NEGATIVE, restrictions);
  const modelName = await g.resolveGraphicsModel(userId);
  const provider = await g.resolveGraphicsProvider(userId, modelName);
  const seed = newSeed();
  const w = g.clampDimension(width);
  const h = g.clampDimension(height);

  if (provider === 'fal') {
    const out = await g.generateWithFal({ prompt, width: w, height: h, seed, modelName });
    const cost = g.estimateGenerateCost({ provider: 'fal' });
    g.logImageUsage({ userId, model: `fal:${modelName}`, feature: FEATURE, costUsd: cost.usd });
    return { imageDataUrl: out.imageDataUrl, seed: out.seed, model: modelName, costUsd: cost.usd };
  }
  if (provider !== 'local-comfyui') throw Object.assign(new Error(`Image provider ${provider} is not supported yet`), { status: 400 });
  const imageDataUrl = await comfyRun(g.buildWorkflow({ prompt, negativePrompt, width: w, height: h, seed, modelName }));
  return { imageDataUrl, seed, model: modelName, costUsd: 0 };
}

async function change({ userId, prompt, imageDataUrl }) {
  const restrictions = await g.loadContentRestrictions();
  g.assertPromptAllowed(prompt, restrictions);
  const modelName = await g.resolveGraphicsModel(userId);
  const provider = await g.resolveGraphicsProvider(userId, modelName);
  const seed = newSeed();

  if (provider === 'fal') {
    const out = await editWithFal({ prompt, imageDataUrl, seed });
    const costUsd = editCostUsd();
    g.logImageUsage({ userId, model: `fal:${out.model}`, feature: FEATURE, costUsd });
    return { imageDataUrl: out.imageDataUrl, seed: out.seed, model: out.model, costUsd };
  }
  if (provider !== 'local-comfyui') throw Object.assign(new Error(`Image provider ${provider} is not supported yet`), { status: 400 });
  const imageName = await g.uploadImageToComfy(imageDataUrl);
  const negativePrompt = g.buildNegativePrompt(NEGATIVE, restrictions);
  const out = await comfyRun(g.buildAugmentWorkflow({ prompt, negativePrompt, imageName, seed, denoise: 0.5, modelName }));
  return { imageDataUrl: out, seed, model: modelName, costUsd: 0 };
}

/** The picture as a JPEG data URL, longest side at most 1024px, so what is stored and sent back for the next change stays small. */
async function normalise(imageDataUrl) {
  const buf = g.dataUrlToBuffer(imageDataUrl);
  if (!buf) throw new Error('The image service returned something that is not a picture');
  const out = await sharp(buf).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  const meta = await sharp(out).metadata();
  return { imageDataUrl: `data:image/jpeg;base64,${out.toString('base64')}`, width: meta.width || 0, height: meta.height || 0 };
}

async function thumbnail(imageDataUrl) {
  try {
    const buf = g.dataUrlToBuffer(imageDataUrl);
    if (!buf) return null;
    const out = await sharp(buf).rotate().resize(320, 320, { fit: 'inside' }).flatten({ background: '#ffffff' }).jpeg({ quality: 72 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch { return null; }
}

module.exports = { draw, change, price, normalise, thumbnail, FEATURE, EDIT_MODEL_DEFAULT };
