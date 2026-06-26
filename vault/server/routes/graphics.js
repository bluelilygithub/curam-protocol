'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const { runtimeConfig } = require('../config/runtime');
const { pool } = require('../db');
const { getVaultModelsConfigForUser } = require('../services/modelResolver');

const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';
const DEFAULT_MODEL = 'DreamShaper_8_pruned.safetensors';
const DEFAULT_FAL_MODEL = 'fal-ai/flux/dev';
const CONTENT_RESTRICTIONS_KEY = 'graphics_content_restrictions';
const GRAPHICS_MODEL_KEY = 'graphics_model';

// Upscaling. Local uses a ComfyUI Real-ESRGAN/ESRGAN model (Remacri, UltraSharp,
// etc.); production uses a fidelity-preserving Replicate model.
const UPSCALE_MODEL_KEY = 'graphics_upscale_model';
const DEFAULT_LOCAL_UPSCALE_MODEL = '4x-UltraSharp.pth';
const DEFAULT_REPLICATE_UPSCALE_MODEL = 'philz1337x/clarity-pro-upscaler';

// Hosted upscale options offered in the UI. Real-ESRGAN is pure super-resolution
// (cannot hallucinate); Clarity adds detail. Selectable per upscale.
const HOSTED_UPSCALE_MODELS = [
  { id: 'nightmareai/real-esrgan', label: 'Real-ESRGAN — faithful (no hallucination)', kind: 'faithful' },
  { id: 'philz1337x/clarity-pro-upscaler', label: 'Clarity Pro — enhanced (adds detail)', kind: 'enhanced' },
];

// Image format conversion (sharp / libvips, runs locally on the server — free).
// `lossy` formats expose a quality control; `id` is the value passed to sharp.
const CONVERT_FORMATS = [
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', lossy: false },
  { id: 'jpeg', label: 'JPG / JPEG', mime: 'image/jpeg', ext: 'jpg', lossy: true },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true },
  { id: 'gif', label: 'GIF', mime: 'image/gif', ext: 'gif', lossy: false },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif', lossy: true },
  { id: 'tiff', label: 'TIFF', mime: 'image/tiff', ext: 'tiff', lossy: false },
];

function comfyBaseUrl() {
  return String(runtimeConfig.localImageApiUrl || DEFAULT_COMFY_URL).replace(/\/$/, '');
}

function normalizeGraphicsProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'seedance') return 'fal';
  return normalized;
}

async function resolveGraphicsModel(userId) {
  if (runtimeConfig.isLocal) {
    return runtimeConfig.localImageModel || DEFAULT_MODEL;
  }

  if (userId) {
    const { rows } = await pool.query(
      'SELECT value FROM settings WHERE "userId"=$1 AND key=$2 LIMIT 1',
      [userId, GRAPHICS_MODEL_KEY]
    );
    const userModel = String(rows[0]?.value || '').trim();
    if (userModel) return userModel;
  }

  const { rows } = await pool.query(
    `SELECT s.value
     FROM settings s
     JOIN users u ON u.id = s."userId"
     WHERE u."isAdmin" = TRUE
       AND s.key = $1
       AND COALESCE(NULLIF(TRIM(s.value), ''), '') <> ''
     ORDER BY u.id ASC
     LIMIT 1`,
    [GRAPHICS_MODEL_KEY]
  );
  const adminModel = String(rows[0]?.value || '').trim();
  return adminModel || runtimeConfig.localImageModel || DEFAULT_MODEL;
}

async function resolveGraphicsProvider(userId, selectedModel) {
  if (runtimeConfig.isLocal) return 'local-comfyui';
  if (runtimeConfig.imageProvider) return normalizeGraphicsProvider(runtimeConfig.imageProvider);
  if (!selectedModel) return runtimeConfig.isProduction ? 'fal' : 'local-comfyui';

  const config = await getVaultModelsConfigForUser(userId);
  const configuredModel = config.models.find((model) => model.id === selectedModel);
  return normalizeGraphicsProvider(configuredModel?.provider) || (runtimeConfig.isProduction ? 'fal' : 'local-comfyui');
}

function isTurboModel(modelName) {
  return /turbo|lightning|lcm/i.test(modelName || '');
}

function samplerSettings(modelName, { mode = 'generate', denoise = 1 } = {}) {
  if (isTurboModel(modelName)) {
    return {
      steps: mode === 'augment' ? 4 : 2,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise,
    };
  }
  return {
    steps: mode === 'augment' ? 14 : 24,
    cfg: 7,
    sampler_name: 'dpmpp_2m',
    scheduler: 'karras',
    denoise,
  };
}

function ollamaBaseUrl() {
  return String(runtimeConfig.ollamaBaseUrl || 'http://localhost:11434').replace(/\/$/, '');
}

function localTextModel() {
  return runtimeConfig.defaultLocalModel || 'qwen2.5-coder:14b';
}

function clampDimension(value) {
  const n = Number(value) || 512;
  const rounded = Math.round(n / 64) * 64;
  return Math.max(256, Math.min(1024, rounded));
}

function normalizeContentRestrictions(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 50);
}

async function loadContentRestrictions() {
  try {
    const { rows } = await pool.query(
      'SELECT value FROM workspace_settings WHERE key=$1 LIMIT 1',
      [CONTENT_RESTRICTIONS_KEY]
    );
    if (!rows[0]?.value) return [];
    return normalizeContentRestrictions(JSON.parse(rows[0].value));
  } catch {
    return [];
  }
}

function buildNegativePrompt(baseNegativePrompt, restrictions = []) {
  return [
    baseNegativePrompt || 'blurry, distorted, low quality, text, watermark',
    ...restrictions.map((restriction) => `no ${restriction}`),
  ].filter(Boolean).join(', ');
}

function restrictionSearchTerms(restriction) {
  const raw = String(restriction || '').trim().toLowerCase();
  const terms = new Set([raw]);
  raw.split(/[^a-z0-9]+/i).forEach((part) => {
    if (part.length >= 4) terms.add(part);
  });
  if (raw.includes('nud')) {
    ['nude', 'nudity', 'naked'].forEach((term) => terms.add(term));
  }
  if (raw.includes('viol')) {
    ['violence', 'violent'].forEach((term) => terms.add(term));
  }
  if (raw.includes('gore')) {
    ['gore', 'gory'].forEach((term) => terms.add(term));
  }
  return Array.from(terms).filter(Boolean);
}

function findRestrictionMatches(prompt, restrictions = []) {
  const source = String(prompt || '').toLowerCase();
  return restrictions
    .map((restriction) => {
      const matchedTerms = restrictionSearchTerms(restriction)
        .filter((term) => source.includes(term));
      return matchedTerms.length ? { restriction, matchedTerms } : null;
    })
    .filter(Boolean);
}

function buildWorkflow({ prompt, negativePrompt, width, height, seed, modelName }) {
  const sampler = samplerSettings(modelName);
  return {
    3: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: modelName },
    },
    4: {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['3', 1] },
    },
    5: {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    6: {
      class_type: 'KSampler',
      inputs: {
        seed,
        ...sampler,
        model: ['3', 0],
        positive: ['4', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    7: {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: negativePrompt || 'blurry, distorted, low quality, text, watermark',
        clip: ['3', 1],
      },
    },
    8: {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['3', 2] },
    },
    9: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'vault_graphics', images: ['8', 0] },
    },
  };
}

function buildAugmentWorkflow({ prompt, negativePrompt, imageName, seed, denoise, modelName }) {
  const sampler = samplerSettings(modelName, { mode: 'augment', denoise });
  return {
    3: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: modelName },
    },
    4: {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['3', 1] },
    },
    5: {
      class_type: 'LoadImage',
      inputs: { image: imageName },
    },
    6: {
      class_type: 'VAEEncode',
      inputs: { pixels: ['5', 0], vae: ['3', 2] },
    },
    7: {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: negativePrompt || 'blurry, distorted, low quality, text, watermark',
        clip: ['3', 1],
      },
    },
    8: {
      class_type: 'KSampler',
      inputs: {
        seed,
        ...sampler,
        model: ['3', 0],
        positive: ['4', 0],
        negative: ['7', 0],
        latent_image: ['6', 0],
      },
    },
    9: {
      class_type: 'VAEDecode',
      inputs: { samples: ['8', 0], vae: ['3', 2] },
    },
    10: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'vault_graphics_augmented', images: ['9', 0] },
    },
  };
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error || `Graphics provider request failed (${res.status})`);
  }
  return data;
}

function resolveFalEndpoint(modelName, mode = 'generate') {
  const raw = String(modelName || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, '-');
  let endpoint = raw || DEFAULT_FAL_MODEL;
  if (['flux-dev', 'flux.1-dev', 'flux-dev-1', 'fal-ai/flux-dev'].includes(key)) {
    endpoint = DEFAULT_FAL_MODEL;
  }
  if (!endpoint.includes('/') && endpoint.toLowerCase().includes('flux') && endpoint.toLowerCase().includes('dev')) {
    endpoint = DEFAULT_FAL_MODEL;
  }
  endpoint = endpoint.replace(/^https:\/\/fal\.run\//, '').replace(/^\/+/, '');
  if (mode === 'augment' && !endpoint.endsWith('/image-to-image')) {
    endpoint = `${endpoint}/image-to-image`;
  }
  return endpoint;
}

function falImageSize(width, height) {
  if (width === height) return width > 512 ? 'square_hd' : 'square';
  return width > height ? 'landscape_4_3' : 'portrait_4_3';
}

async function imageUrlToDataUrl(url, contentType = 'image/jpeg') {
  const imageUrl = String(url || '');
  if (imageUrl.startsWith('data:image/')) return imageUrl;
  if (!imageUrl) throw new Error('FAL did not return an image URL');
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch generated FAL image (${res.status})`);
  const mime = res.headers.get('content-type') || contentType || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function generateWithFal({ prompt, width, height, seed, modelName }) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY is not configured');

  const endpoint = resolveFalEndpoint(modelName);
  const data = await fetchJson(`https://fal.run/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: falImageSize(width, height),
      num_inference_steps: 28,
      guidance_scale: 3.5,
      sync_mode: true,
      num_images: 1,
      enable_safety_checker: true,
      output_format: 'jpeg',
      acceleration: 'none',
      seed,
    }),
  });

  const image = Array.isArray(data.images) ? data.images[0] : null;
  if (!image?.url) throw new Error('FAL did not return a generated image');
  const imageDataUrl = await imageUrlToDataUrl(image.url, image.content_type);

  return {
    seed: Number.isFinite(Number(data.seed)) ? Number(data.seed) : seed,
    image: {
      provider: 'fal',
      endpoint,
      url: image.url,
      contentType: image.content_type || 'image/jpeg',
    },
    imageDataUrl,
  };
}

async function refinePromptForImage(rawPrompt, restrictions = []) {
  const source = String(rawPrompt || '').trim();
  if (!source) throw new Error('Prompt required');
  const restrictionLines = restrictions.length
    ? restrictions.map((restriction) => `- ${restriction}`).join('\n')
    : '- None configured';

  const instruction = `Rewrite this into a strong prompt for a local text-to-image model.

Rules:
- Preserve the user's intent.
- Make it visually specific and concrete.
- Include subject, setting, composition, lighting, mood, and style.
- Avoid asking for text, logos, watermarks, or typography.
- Do not include restricted content. If the user asks for restricted content, redirect the image prompt to a safe, non-explicit alternative.
- Return only the final image prompt. No quotes. No explanation.

Restricted content:
${restrictionLines}

User prompt:
${source}`;

  try {
    const data = await fetchJson(`${ollamaBaseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: localTextModel(),
        prompt: instruction,
        stream: false,
        options: { temperature: 0.4, num_predict: 220 },
      }),
    });
    return String(data.response || '').trim() || source;
  } catch (err) {
    console.warn('[graphics] prompt refinement failed:', err.message);
    return source;
  }
}

async function waitForImage(promptId) {
  const base = comfyBaseUrl();
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const history = await fetchJson(`${base}/history/${encodeURIComponent(promptId)}`);
    const result = history[promptId];
    const images = result?.outputs?.['9']?.images || result?.outputs?.['10']?.images;
    if (Array.isArray(images) && images[0]) return images[0];
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Image generation timed out');
}

async function uploadImageToComfy(imageDataUrl) {
  const match = String(imageDataUrl || '').match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) throw new Error('A generated image is required for augmentation');
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const filename = `vault_seed_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const buffer = Buffer.from(match[2], 'base64');
  const blob = new Blob([buffer], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
  const form = new FormData();
  form.append('image', blob, filename);
  form.append('overwrite', 'true');
  const res = await fetch(`${comfyBaseUrl()}/upload/image`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to upload seed image (${res.status})`);
  return data.name || filename;
}

async function loadImageDataUrl(image) {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || '',
    type: image.type || 'output',
  });
  const res = await fetch(`${comfyBaseUrl()}/view?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch generated image (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = image.filename?.toLowerCase().endsWith('.jpg') || image.filename?.toLowerCase().endsWith('.jpeg')
    ? 'image/jpeg'
    : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function listAvailableComfyModels() {
  const data = await fetchJson(`${comfyBaseUrl()}/object_info/CheckpointLoaderSimple`);
  const options = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  return Array.isArray(options) ? options.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

// ─── Upscaling ────────────────────────────────────────────────────────────────

function clampScale(value) {
  const n = Math.round(Number(value) || 4);
  if (n <= 2) return 2;
  if (n <= 4) return 4;
  if (n <= 8) return 8;
  return 16;
}

// Clarity's `creativity` runs -10 (strict to source) .. 10 (adds detail).
// Default to the faithful end since fidelity preservation is the priority.
function clampCreativity(value) {
  if (value === undefined || value === null || value === '') return -5;
  const n = Number(value);
  if (!Number.isFinite(n)) return -5;
  return Math.max(-10, Math.min(10, n));
}

async function listAvailableUpscaleModels() {
  const data = await fetchJson(`${comfyBaseUrl()}/object_info/UpscaleModelLoader`);
  const options = data?.UpscaleModelLoader?.input?.required?.model_name?.[0];
  return Array.isArray(options) ? options.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

async function resolveUpscaleModel(userId) {
  if (userId) {
    const { rows } = await pool.query(
      'SELECT value FROM settings WHERE "userId"=$1 AND key=$2 LIMIT 1',
      [userId, UPSCALE_MODEL_KEY]
    );
    const userModel = String(rows[0]?.value || '').trim();
    if (userModel) return userModel;
  }
  const { rows } = await pool.query(
    `SELECT s.value FROM settings s
     JOIN users u ON u.id = s."userId"
     WHERE u."isAdmin" = TRUE AND s.key = $1
       AND COALESCE(NULLIF(TRIM(s.value), ''), '') <> ''
     ORDER BY u.id ASC LIMIT 1`,
    [UPSCALE_MODEL_KEY]
  );
  const adminModel = String(rows[0]?.value || '').trim();
  return adminModel || String(process.env.LOCAL_UPSCALE_MODEL || '').trim() || DEFAULT_LOCAL_UPSCALE_MODEL;
}

// ComfyUI workflow: LoadImage -> UpscaleModelLoader -> ImageUpscaleWithModel ->
// (optional lanczos rescale to hit the requested factor) -> SaveImage (node 9,
// so the existing waitForImage finds it).
function buildUpscaleWorkflow({ imageName, upscaleModelName, scaleBy }) {
  const wf = {
    5:  { class_type: 'LoadImage', inputs: { image: imageName } },
    11: { class_type: 'UpscaleModelLoader', inputs: { model_name: upscaleModelName } },
    12: { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['11', 0], image: ['5', 0] } },
  };
  let finalNode = '12';
  if (scaleBy && Math.abs(scaleBy - 1) > 0.001) {
    wf[13] = {
      class_type: 'ImageScaleBy',
      inputs: { image: ['12', 0], upscale_method: 'lanczos', scale_by: scaleBy },
    };
    finalNode = '13';
  }
  wf[9] = { class_type: 'SaveImage', inputs: { filename_prefix: 'vault_upscale', images: [finalNode, 0] } };
  return wf;
}

function buildReplicateUpscaleInput(model, { imageDataUrl, scale, creativity }) {
  const lower = String(model).toLowerCase();
  let input;
  if (lower.includes('clarity')) {
    input = { image: imageDataUrl, scale_factor: scale, creativity, output_format: 'png' };
  } else if (lower.includes('real-esrgan') || lower.includes('realesrgan')) {
    input = { image: imageDataUrl, scale };
  } else if (lower.includes('topaz')) {
    input = { image: imageDataUrl, upscale_factor: scale };
  } else {
    input = { image: imageDataUrl, scale_factor: scale };
  }
  const extraRaw = String(process.env.REPLICATE_UPSCALE_INPUT || '').trim();
  if (extraRaw) {
    try { Object.assign(input, JSON.parse(extraRaw)); }
    catch (err) { console.warn('[graphics] invalid REPLICATE_UPSCALE_INPUT JSON:', err.message); }
  }
  return input;
}

async function waitForReplicate(prediction, token) {
  let pred = prediction;
  const started = Date.now();
  const terminal = ['succeeded', 'failed', 'canceled'];
  while (pred && !terminal.includes(pred.status) && Date.now() - started < 180000) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const getUrl = pred.urls?.get;
    if (!getUrl) break;
    const res = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
    pred = await res.json().catch(() => pred);
  }
  if (pred?.status !== 'succeeded') {
    throw new Error(pred?.error || `Replicate upscale ${pred?.status || 'did not complete'}`);
  }
  return pred;
}

function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/);
  return m ? Buffer.from(m[1], 'base64') : null;
}

// Minimal PNG/JPEG dimension reader (avoids a heavy image dependency).
function getImageSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      const isSof = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return null;
}

// Clarity-style billing is per output megapixel ($0.03/MP, $0.03 min). Local
// ComfyUI runs on the user's own hardware, so it's free. For other Replicate
// models that bill by compute time this is a best-effort estimate.
function estimateUpscaleCost({ provider, inputBuffer, scale }) {
  if (provider === 'local-comfyui') return { usd: 0, megapixels: null, local: true };
  const ratePerMp = Number(process.env.REPLICATE_UPSCALE_RATE_PER_MP) || 0.03;
  const minUsd = Number(process.env.REPLICATE_UPSCALE_MIN_USD) || 0.03;
  const size = inputBuffer ? getImageSize(inputBuffer) : null;
  if (!size) return { usd: null, megapixels: null, ratePerMp, estimate: true };
  const megapixels = Math.min(64, (size.width * scale * size.height * scale) / 1e6);
  const usd = Math.max(minUsd, megapixels * ratePerMp);
  return { usd: Number(usd.toFixed(4)), megapixels: Number(megapixels.toFixed(2)), ratePerMp, estimate: true };
}

function estimateGenerateCost({ provider }) {
  if (provider === 'local-comfyui') return { usd: 0, local: true };
  const usd = Number(process.env.FAL_IMAGE_COST_USD) || 0.025;
  return { usd: Number(usd.toFixed(4)), estimate: true };
}

// Image operations have no tokens, so logUsage (which ignores zero-token rows)
// can't be used. Write the usage_logs row directly so cost shows in the dashboard.
function logImageUsage({ userId, model, feature, costUsd }) {
  if (!userId || !costUsd || costUsd <= 0) return;
  pool.query(
    `INSERT INTO usage_logs (user_id, model_id, input_tokens, output_tokens, estimated_cost_usd, feature)
     VALUES ($1, $2, 0, 0, $3, $4)`,
    [userId, model || feature, costUsd, feature]
  ).catch((err) => console.error('[graphics] usage log error:', err.message));
}

function envReplicateUpscaleModel() {
  return String(process.env.REPLICATE_UPSCALE_MODEL || DEFAULT_REPLICATE_UPSCALE_MODEL).trim();
}

// Only allow the curated hosted models plus whatever the admin set via env, so a
// client can't trigger arbitrary (billable) Replicate models.
function resolveHostedUpscaleModel(requestedModel) {
  const allowed = new Set([...HOSTED_UPSCALE_MODELS.map((m) => m.id), envReplicateUpscaleModel()]);
  const requested = String(requestedModel || '').trim();
  return allowed.has(requested) ? requested : envReplicateUpscaleModel();
}

async function upscaleWithReplicate({ imageDataUrl, scale, creativity, model: requestedModel }) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN is not configured');
  const model = resolveHostedUpscaleModel(requestedModel);
  const input = buildReplicateUpscaleInput(model, { imageDataUrl, scale, creativity });

  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({ input }),
  });
  let pred = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(pred?.detail || pred?.error || `Replicate request failed (${res.status})`);

  pred = await waitForReplicate(pred, token);
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!out) throw new Error('Replicate returned no upscaled image');
  const upscaledDataUrl = await imageUrlToDataUrl(out, 'image/png');
  return { provider: 'replicate', model, url: typeof out === 'string' ? out : null, imageDataUrl: upscaledDataUrl };
}

router.get('/models', async (req, res) => {
  try {
    const selectedModel = await resolveGraphicsModel(req.user.id);
    const provider = await resolveGraphicsProvider(req.user.id, selectedModel);
    let availableModels = [];
    if (provider === 'local-comfyui') {
      availableModels = await listAvailableComfyModels().catch(() => []);
    } else {
      const config = await getVaultModelsConfigForUser(req.user.id);
      availableModels = config.models
        .filter((model) => normalizeGraphicsProvider(model.provider) === 'fal')
        .map((model) => model.id);
    }
    res.json({
      selectedModel,
      availableModels,
      provider,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', async (req, res) => {
  const selectedModel = await resolveGraphicsModel(req.user.id);
  const provider = await resolveGraphicsProvider(req.user.id, selectedModel);

  if (provider !== 'local-comfyui') {
    const configured = provider === 'fal' ? Boolean(process.env.FAL_API_KEY) : false;
    return res.json({
      ok: Boolean(selectedModel && configured),
      provider,
      model: selectedModel,
      hosted: true,
      configured,
      error: !selectedModel
        ? 'No graphics model selected'
        : configured
          ? null
          : `Missing API key for ${provider}`,
    });
  }

  try {
    const info = await fetchJson(`${comfyBaseUrl()}/system_stats`);
    res.json({
      ok: true,
      provider,
      apiUrl: comfyBaseUrl(),
      model: selectedModel,
      comfyui: true,
      device: info?.devices?.[0]?.name || null,
    });
  } catch (err) {
    res.json({
      ok: false,
      provider,
      apiUrl: comfyBaseUrl(),
      model: selectedModel,
      comfyui: false,
      error: err.message,
    });
  }
});

router.post('/refine', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt required' });
    const restrictions = await loadContentRestrictions();
    const refinedPrompt = await refinePromptForImage(prompt, restrictions);
    res.json({
      ok: true,
      prompt,
      refinedPrompt,
      model: localTextModel(),
      restrictions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/preflight', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt required' });
    const restrictions = await loadContentRestrictions();
    const matches = findRestrictionMatches(prompt, restrictions);
    res.json({
      ok: true,
      restricted: matches.length > 0,
      matches,
      restrictions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt required' });
    const restrictions = await loadContentRestrictions();
    const negativePrompt = buildNegativePrompt(String(req.body?.negativePrompt || '').trim(), restrictions);
    const modelName = await resolveGraphicsModel(req.user.id);
    const provider = await resolveGraphicsProvider(req.user.id, modelName);

    const width = clampDimension(req.body?.width);
    const height = clampDimension(req.body?.height);
    const seed = Number.isFinite(Number(req.body?.seed))
      ? Math.floor(Number(req.body.seed))
      : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const refinedPrompt = req.body?.skipRefine ? prompt : await refinePromptForImage(prompt, restrictions);

    if (provider === 'fal') {
      const falResult = await generateWithFal({
        prompt: refinedPrompt,
        width,
        height,
        seed,
        modelName,
      });
      const cost = estimateGenerateCost({ provider: 'fal' });
      logImageUsage({ userId: req.user.id, model: `fal:${modelName}`, feature: 'graphics_generate', costUsd: cost.usd });
      return res.json({
        ok: true,
        prompt,
        refinedPrompt,
        seed: falResult.seed,
        width,
        height,
        model: modelName,
        cost,
        image: falResult.image,
        imageDataUrl: falResult.imageDataUrl,
        restrictions,
      });
    }

    if (provider !== 'local-comfyui') {
      return res.status(400).json({ error: `Image provider ${provider} is not supported yet` });
    }

    const clientId = randomUUID();
    const workflow = buildWorkflow({
      prompt: refinedPrompt,
      negativePrompt,
      width,
      height,
      seed,
      modelName,
    });

    const queued = await fetchJson(`${comfyBaseUrl()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });

    const image = await waitForImage(queued.prompt_id);
    const imageDataUrl = await loadImageDataUrl(image);

    res.json({
      ok: true,
      prompt,
      refinedPrompt,
      seed,
      width,
      height,
      model: modelName,
      cost: estimateGenerateCost({ provider: 'local-comfyui' }),
      image,
      imageDataUrl,
      restrictions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/augment', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Augmentation prompt required' });
    const sourceImageDataUrl = String(req.body?.imageDataUrl || '');
    const restrictions = await loadContentRestrictions();
    const negativePrompt = buildNegativePrompt(String(req.body?.negativePrompt || '').trim(), restrictions);
    const modelName = await resolveGraphicsModel(req.user.id);
    const provider = await resolveGraphicsProvider(req.user.id, modelName);
    if (provider !== 'local-comfyui') {
      return res.status(400).json({ error: `Image provider ${provider} is not supported yet` });
    }
    const seed = Number.isFinite(Number(req.body?.seed))
      ? Math.floor(Number(req.body.seed))
      : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const denoise = Math.max(0.15, Math.min(0.85, Number(req.body?.denoise) || 0.45));
    const imageName = await uploadImageToComfy(sourceImageDataUrl);
    const clientId = randomUUID();
    const workflow = buildAugmentWorkflow({
      prompt,
      negativePrompt,
      imageName,
      seed,
      denoise,
      modelName,
    });

    const queued = await fetchJson(`${comfyBaseUrl()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });

    const image = await waitForImage(queued.prompt_id);
    const imageDataUrl = await loadImageDataUrl(image);

    res.json({
      ok: true,
      prompt,
      seed,
      denoise,
      model: modelName,
      image,
      imageDataUrl,
      restrictions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/gallery', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, prompt, model, seed, width, height, metadata, "createdAt", "imageDataUrl"
       FROM graphics_gallery
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC, id DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/gallery', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    if (!prompt || !imageDataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Prompt and image required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO graphics_gallery ("userId", prompt, "imageDataUrl", model, seed, width, height, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, prompt, model, seed, width, height, metadata, "createdAt", "imageDataUrl"`,
      [
        req.user.id,
        prompt,
        imageDataUrl,
        req.body?.model || null,
        req.body?.seed != null ? String(req.body.seed) : null,
        Number(req.body?.width) || null,
        Number(req.body?.height) || null,
        req.body?.metadata || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/gallery/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM graphics_gallery WHERE id=$1 AND "userId"=$2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/graphics/upscale/info — provider, model, available models, supported scales
router.get('/upscale/info', async (req, res) => {
  try {
    if (runtimeConfig.isLocal) {
      const model = await resolveUpscaleModel(req.user.id);
      const available = await listAvailableUpscaleModels().catch(() => []);
      const models = available.map((m) => ({ id: m, label: m, kind: 'faithful' }));
      if (model && !models.some((m) => m.id === model)) {
        models.unshift({ id: model, label: model, kind: 'faithful' });
      }
      return res.json({
        provider: 'local-comfyui',
        model,
        models,
        scales: [2, 4],
        configured: true,
        apiUrl: comfyBaseUrl(),
      });
    }
    const model = envReplicateUpscaleModel();
    const configured = Boolean(process.env.REPLICATE_API_TOKEN);
    const models = [...HOSTED_UPSCALE_MODELS];
    if (!models.some((m) => m.id === model)) {
      models.unshift({ id: model, label: model, kind: 'custom' });
    }
    res.json({
      provider: 'replicate',
      model,
      models,
      scales: [2, 4, 8],
      configured,
      error: configured ? null : 'REPLICATE_API_TOKEN is not configured',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/graphics/upscale — fidelity-first upscale (ComfyUI local / Replicate prod)
router.post('/upscale', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A PNG, JPEG or WebP image is required' });
    }
    const scale = clampScale(req.body?.scale);
    const creativity = clampCreativity(req.body?.creativity);
    const requestedModel = String(req.body?.model || '').trim();

    const inputBuffer = dataUrlToBuffer(imageDataUrl);

    if (!runtimeConfig.isLocal) {
      const result = await upscaleWithReplicate({ imageDataUrl, scale, creativity, model: requestedModel });
      const cost = estimateUpscaleCost({ provider: 'replicate', inputBuffer, scale });
      logImageUsage({ userId: req.user.id, model: `replicate:${result.model}`, feature: 'graphics_upscale', costUsd: cost.usd });
      return res.json({
        ok: true,
        provider: result.provider,
        model: result.model,
        scale,
        cost,
        image: { provider: 'replicate', url: result.url },
        imageDataUrl: result.imageDataUrl,
      });
    }

    let upscaleModelName = await resolveUpscaleModel(req.user.id);
    if (requestedModel) {
      const available = await listAvailableUpscaleModels().catch(() => []);
      if (available.includes(requestedModel)) upscaleModelName = requestedModel;
    }
    const native = Number(process.env.LOCAL_UPSCALE_NATIVE) || 4;
    const scaleBy = scale / native;
    const imageName = await uploadImageToComfy(imageDataUrl);
    const clientId = randomUUID();
    const workflow = buildUpscaleWorkflow({ imageName, upscaleModelName, scaleBy });

    const queued = await fetchJson(`${comfyBaseUrl()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    const image = await waitForImage(queued.prompt_id);
    const imageDataUrlOut = await loadImageDataUrl(image);

    res.json({
      ok: true,
      provider: 'local-comfyui',
      model: upscaleModelName,
      scale,
      cost: estimateUpscaleCost({ provider: 'local-comfyui', inputBuffer, scale }),
      image,
      imageDataUrl: imageDataUrlOut,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function clampQuality(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 90;
  return Math.min(100, Math.max(1, n));
}

router.get('/convert/info', (req, res) => {
  res.json({ formats: CONVERT_FORMATS });
});

router.post('/convert', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }

    const requested = String(req.body?.format || '').trim().toLowerCase();
    const target = CONVERT_FORMATS.find((f) => f.id === requested || f.ext === requested || (requested === 'jpg' && f.id === 'jpeg'));
    if (!target) {
      return res.status(400).json({ error: `Unsupported target format. Choose one of: ${CONVERT_FORMATS.map((f) => f.id).join(', ')}` });
    }

    const quality = clampQuality(req.body?.quality);
    const pipeline = sharp(buffer, { animated: true });
    const options = target.lossy ? { quality } : {};
    const outBuffer = await pipeline.toFormat(target.id, options).toBuffer();
    const meta = await sharp(outBuffer).metadata().catch(() => null);

    res.json({
      ok: true,
      format: target.id,
      mime: target.mime,
      ext: target.ext,
      quality: target.lossy ? quality : null,
      width: meta?.width || null,
      height: meta?.height || null,
      bytes: outBuffer.length,
      imageDataUrl: `data:${target.mime};base64,${outBuffer.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
});

module.exports = router;
