'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const archiver = require('archiver');
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

// Background removal. Local uses the self-contained @imgly ONNX model (loaded
// lazily so production doesn't pay the onnxruntime startup cost); production uses
// a Replicate background-remover model.
const DEFAULT_REPLICATE_BG_MODEL = '851-labs/background-remover';
let _imgly = null;
function getImgly() {
  if (!_imgly) _imgly = require('@imgly/background-removal-node');
  return _imgly;
}

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

// Map a data URL mime to the sharp format id (the format we'll re-encode back to).
function detectImageFormat(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/([a-z0-9.+-]+);base64,/i);
  if (!m) return null;
  const sub = m[1].toLowerCase();
  if (sub === 'jpg' || sub === 'jpeg') return 'jpeg';
  if (sub === 'svg+xml') return 'png';
  if (['png', 'webp', 'gif', 'avif', 'tiff'].includes(sub)) return sub;
  return null;
}

// Compression options per format. Lossy formats honour quality; PNG uses palette
// quantization + max zlib for meaningful savings; GIF/TIFF use their own knobs.
function buildCompressOptions(format, quality) {
  switch (format) {
    case 'jpeg': return { quality, mozjpeg: true };
    case 'webp': return { quality, effort: 6 };
    case 'avif': return { quality, effort: 4 };
    case 'png': return { quality, compressionLevel: 9, palette: true, effort: 8 };
    case 'tiff': return { quality, compression: 'jpeg' };
    case 'gif': return { effort: 10 };
    default: return { quality };
  }
}

router.post('/compress', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }

    const format = detectImageFormat(imageDataUrl);
    if (!format) {
      return res.status(400).json({ error: 'Unsupported image type' });
    }

    const fmtMeta = CONVERT_FORMATS.find((f) => f.id === format) || { mime: `image/${format}`, ext: format };
    const quality = clampQuality(req.body?.quality);
    const options = buildCompressOptions(format, quality);
    const outBuffer = await sharp(buffer, { animated: true }).toFormat(format, options).toBuffer();
    const meta = await sharp(outBuffer).metadata().catch(() => null);

    const originalBytes = buffer.length;
    const compressedBytes = outBuffer.length;
    const savedBytes = originalBytes - compressedBytes;
    const savedPct = originalBytes > 0 ? Number(((savedBytes / originalBytes) * 100).toFixed(1)) : 0;
    // Never hand back a larger file: keep the original if compression didn't help.
    const useOriginal = compressedBytes >= originalBytes;

    res.json({
      ok: true,
      format,
      mime: fmtMeta.mime,
      ext: fmtMeta.ext,
      quality: format === 'gif' ? null : quality,
      width: meta?.width || null,
      height: meta?.height || null,
      originalBytes,
      compressedBytes: useOriginal ? originalBytes : compressedBytes,
      savedBytes: useOriginal ? 0 : savedBytes,
      savedPct: useOriginal ? 0 : savedPct,
      noGain: useOriginal,
      imageDataUrl: useOriginal ? imageDataUrl : `data:${fmtMeta.mime};base64,${outBuffer.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Compression failed' });
  }
});

function dataUrlMime(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,/i);
  return m ? m[1] : 'image/png';
}

function parseHexColor(value) {
  let hex = String(value || '').trim();
  const m = hex.match(/^#?([0-9a-f]{6})$/i) || hex.match(/^#?([0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), hex: `#${h.toLowerCase()}` };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

async function removeBgLocal(buffer, mime) {
  const { removeBackground } = getImgly();
  const blob = new Blob([buffer], { type: mime || 'image/png' });
  const result = await removeBackground(blob);
  return Buffer.from(await result.arrayBuffer());
}

async function removeBgWithReplicate(imageDataUrl) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN is not configured');
  const model = String(process.env.REPLICATE_BG_MODEL || DEFAULT_REPLICATE_BG_MODEL).trim();
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify({ input: { image: imageDataUrl } }),
  });
  let pred = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(pred?.detail || pred?.error || `Replicate request failed (${res.status})`);
  pred = await waitForReplicate(pred, token);
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!out) throw new Error('Replicate returned no image');
  const dataUrl = await imageUrlToDataUrl(out, 'image/png');
  return { model, imageDataUrl: dataUrl };
}

router.post('/background', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }

    const bgRaw = String(req.body?.background || 'transparent').trim().toLowerCase();
    const bgColor = bgRaw === 'transparent' ? null : parseHexColor(bgRaw);
    if (bgRaw !== 'transparent' && !bgColor) {
      return res.status(400).json({ error: 'Background must be "transparent" or a hex colour like #ffffff' });
    }

    let cutoutBuffer;
    let provider;
    let cost = { usd: 0, local: true };
    if (runtimeConfig.isLocal) {
      cutoutBuffer = await removeBgLocal(buffer, dataUrlMime(imageDataUrl));
      provider = 'local-imgly';
    } else {
      const result = await removeBgWithReplicate(imageDataUrl);
      cutoutBuffer = dataUrlToBuffer(result.imageDataUrl);
      provider = 'replicate';
      const usd = Number(process.env.REPLICATE_BG_COST_USD) || 0.02;
      cost = { usd: Number(usd.toFixed(4)), estimate: true };
      logImageUsage({ userId: req.user.id, model: `replicate:${result.model}`, feature: 'graphics_background', costUsd: cost.usd });
    }

    const pipeline = sharp(cutoutBuffer);
    const outBuffer = bgColor
      ? await pipeline.flatten({ background: { r: bgColor.r, g: bgColor.g, b: bgColor.b } }).png().toBuffer()
      : await pipeline.png().toBuffer();
    const meta = await sharp(outBuffer).metadata().catch(() => null);

    res.json({
      ok: true,
      provider,
      background: bgColor ? bgColor.hex : 'transparent',
      width: meta?.width || null,
      height: meta?.height || null,
      bytes: outBuffer.length,
      cost,
      imageDataUrl: `data:image/png;base64,${outBuffer.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Background removal failed' });
  }
});

router.post('/recolor', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const source = parseHexColor(req.body?.sourceColor);
    const target = parseHexColor(req.body?.targetColor);
    if (!source || !target) {
      return res.status(400).json({ error: 'sourceColor and targetColor must be hex colours like #ff0000' });
    }
    // tolerance 0-100 maps to a max RGB distance. Cap well below the theoretical
    // max (~441) so the slider stays selective instead of grabbing half the image.
    const tolerance = Math.min(100, Math.max(0, Number(req.body?.tolerance)));
    const maxDist = (Number.isFinite(tolerance) ? tolerance : 20) / 100 * 255;

    // 'preserve' keeps each pixel's lightness (hue-only swap, best for same-tone
    // changes). 'match' shifts lightness toward the target so a dark item can
    // become a light colour, keeping relative shading.
    const mode = req.body?.mode === 'preserve' ? 'preserve' : 'match';
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const targetHsl = rgbToHsl(target.r, target.g, target.b);
    const sourceHsl = rgbToHsl(source.r, source.g, source.b);
    const lShift = targetHsl.l - sourceHsl.l;
    let matched = 0;

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const dist = Math.sqrt((r - source.r) ** 2 + (g - source.g) ** 2 + (b - source.b) ** 2);
      if (dist > maxDist) continue;
      // Soft falloff at the edge of the tolerance band to avoid hard jaggies.
      const weight = maxDist > 0 ? Math.min(1, 1 - dist / maxDist + 0.15) : 1;
      const px = rgbToHsl(r, g, b);
      const newL = mode === 'preserve' ? px.l : Math.min(1, Math.max(0, px.l + lShift));
      const recol = hslToRgb(targetHsl.h, targetHsl.s, newL);
      data[i] = Math.round(r + (recol.r - r) * weight);
      data[i + 1] = Math.round(g + (recol.g - g) * weight);
      data[i + 2] = Math.round(b + (recol.b - b) * weight);
      matched += 1;
    }

    const outBuffer = await sharp(data, { raw: { width: info.width, height: info.height, channels } }).png().toBuffer();
    const totalPx = info.width * info.height;
    res.json({
      ok: true,
      mode,
      sourceColor: source.hex,
      targetColor: target.hex,
      tolerance,
      matchedPixels: matched,
      matchedPct: totalPx > 0 ? Number(((matched / totalPx) * 100).toFixed(1)) : 0,
      width: info.width,
      height: info.height,
      imageDataUrl: `data:image/png;base64,${outBuffer.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Recolour failed' });
  }
});

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function outputFormatFor(meta) {
  return ['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff'].includes(meta?.format) ? meta.format : 'png';
}

function parseAspect(value) {
  const m = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  return { w, h };
}

const GRAVITY_MAP = {
  center: 'centre', centre: 'centre',
  top: 'north', bottom: 'south', left: 'west', right: 'east',
  'top-left': 'northwest', 'top-right': 'northeast',
  'bottom-left': 'southwest', 'bottom-right': 'southeast',
};

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

router.post('/resize', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const meta = await sharp(buffer).metadata();
    const fmt = outputFormatFor(meta);
    const op = req.body?.op === 'crop' ? 'crop' : 'resize';
    let pipeline = sharp(buffer).rotate();

    if (op === 'resize') {
      const width = clampInt(req.body?.width, 1, 12000, undefined);
      const height = clampInt(req.body?.height, 1, 12000, undefined);
      if (!width && !height) return res.status(400).json({ error: 'Provide a width and/or height' });
      const fit = ['cover', 'contain', 'fill', 'inside', 'outside'].includes(req.body?.fit) ? req.body.fit : 'inside';
      pipeline = pipeline.resize({ width, height, fit, withoutEnlargement: false });
    } else if (req.body?.rect && typeof req.body.rect === 'object') {
      // Manual crop to an exact pixel rectangle (from the interactive cropper).
      // Bake EXIF orientation first so the rect lines up with the displayed image.
      const oriented = await sharp(buffer).rotate().toBuffer();
      const om = await sharp(oriented).metadata();
      const W = om.width;
      const H = om.height;
      const left = clampInt(req.body.rect.x, 0, Math.max(0, W - 1), 0);
      const top = clampInt(req.body.rect.y, 0, Math.max(0, H - 1), 0);
      const width = clampInt(req.body.rect.w, 1, W - left, W - left);
      const height = clampInt(req.body.rect.h, 1, H - top, H - top);
      pipeline = sharp(oriented).extract({ left, top, width, height });
    } else {
      const ar = parseAspect(req.body?.aspect);
      if (!ar) return res.status(400).json({ error: 'A valid aspect ratio like 1:1 or 16:9 is required to crop' });
      const W = meta.width;
      const H = meta.height;
      const arVal = ar.w / ar.h;
      let tw;
      let th;
      if (W / H > arVal) { th = H; tw = Math.round(H * arVal); } else { tw = W; th = Math.round(W / arVal); }
      const strat = String(req.body?.strategy || 'smart');
      let position;
      if (strat === 'smart') position = sharp.strategy.attention;
      else if (strat === 'entropy') position = sharp.strategy.entropy;
      else position = GRAVITY_MAP[strat] || 'centre';
      pipeline = pipeline.resize(tw, th, { fit: 'cover', position });
    }

    const out = await pipeline.toFormat(fmt).toBuffer();
    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      op,
      width: m2?.width || null,
      height: m2?.height || null,
      format: fmt,
      bytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Resize failed' });
  }
});

// Favicon / app-icon generator: one source image -> a ZIP of square PNG icons
// in every common size, plus a web manifest and a ready-to-paste <head> snippet.
router.post('/favicon', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const sizes = [16, 32, 48, 64, 180, 192, 256, 512];
    const oriented = await sharp(buffer).rotate().toBuffer();
    const files = [];
    for (const s of sizes) {
      // eslint-disable-next-line no-await-in-loop
      const png = await sharp(oriented).resize(s, s, { fit: 'cover', position: 'centre' }).png().toBuffer();
      files.push({ name: `favicon-${s}x${s}.png`, buf: png });
    }

    const manifest = JSON.stringify({
      name: '',
      short_name: '',
      icons: [
        { src: 'favicon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'favicon-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: '#ffffff',
      background_color: '#ffffff',
      display: 'standalone',
    }, null, 2);

    const html = [
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
      '<link rel="manifest" href="/site.webmanifest">',
    ].join('\n');

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });
    files.forEach((f) => archive.append(f.buf, { name: f.name }));
    const apple = files.find((f) => f.name === 'favicon-180x180.png');
    if (apple) archive.append(apple.buf, { name: 'apple-touch-icon.png' });
    archive.append(manifest, { name: 'site.webmanifest' });
    archive.append(html, { name: 'head-snippet.html' });
    await archive.finalize();
    await done;

    const zip = Buffer.concat(chunks);
    res.json({
      ok: true,
      count: sizes.length,
      sizes,
      bytes: zip.length,
      zipDataUrl: `data:application/zip;base64,${zip.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Favicon generation failed' });
  }
});

router.post('/strip-metadata', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const meta = await sharp(buffer).metadata();
    const removed = [];
    if (meta.exif) removed.push('EXIF (camera, settings, timestamps)');
    if (meta.exif && Buffer.isBuffer(meta.exif) && meta.exif.includes('GPS')) removed.push('GPS location');
    if (meta.xmp) removed.push('XMP');
    if (meta.iptc) removed.push('IPTC');
    if (meta.icc) removed.push('ICC colour profile');
    const fmt = outputFormatFor(meta);
    // sharp drops metadata unless withMetadata() is called; rotate() bakes in the
    // EXIF orientation first so the cleaned image isn't left mis-rotated.
    const out = await sharp(buffer).rotate().toFormat(fmt).toBuffer();
    res.json({
      ok: true,
      removed,
      hadMetadata: removed.length > 0,
      width: meta.width || null,
      height: meta.height || null,
      format: fmt,
      originalBytes: buffer.length,
      cleanedBytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Metadata removal failed' });
  }
});

router.post('/watermark', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const meta = await sharp(buffer).metadata();
    const fmt = outputFormatFor(meta);
    const type = req.body?.type === 'image' ? 'image' : 'text';
    const opacity = Math.min(1, Math.max(0, Number(req.body?.opacity)));
    const op = Number.isFinite(opacity) ? opacity : 0.5;
    const tile = Boolean(req.body?.tile);
    const gravity = GRAVITY_MAP[req.body?.position] || 'southeast';

    let overlay;
    if (type === 'text') {
      const text = String(req.body?.text || '').slice(0, 200);
      if (!text) return res.status(400).json({ error: 'Watermark text is required' });
      const color = parseHexColor(req.body?.color)?.hex || '#ffffff';
      const fontSize = clampInt(req.body?.fontSize, 8, 600, Math.max(16, Math.round(meta.width * 0.06)));
      const w = Math.ceil(text.length * fontSize * 0.62) + 24;
      const h = Math.ceil(fontSize * 1.5);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="50%" y="50%" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${color}" fill-opacity="${op}" text-anchor="middle" dominant-baseline="middle">${escapeXml(text)}</text></svg>`;
      overlay = Buffer.from(svg);
    } else {
      const wmBuf = dataUrlToBuffer(req.body?.watermarkDataUrl || '');
      if (!wmBuf) return res.status(400).json({ error: 'A watermark image is required' });
      const scale = clampInt(req.body?.scale, 1, 100, 25) / 100;
      const targetW = Math.max(1, Math.round(meta.width * scale));
      const wm = await sharp(wmBuf).resize({ width: targetW, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < wm.data.length; i += 4) {
        wm.data[i + 3] = Math.round(wm.data[i + 3] * op);
      }
      overlay = await sharp(wm.data, { raw: { width: wm.info.width, height: wm.info.height, channels: 4 } }).png().toBuffer();
    }

    const composite = tile ? { input: overlay, tile: true } : { input: overlay, gravity };
    const out = await sharp(buffer).rotate().composite([composite]).toFormat(fmt).toBuffer();
    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      type,
      width: m2?.width || null,
      height: m2?.height || null,
      format: fmt,
      bytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Watermark failed' });
  }
});

router.post('/collage', async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    const buffers = images.map((d) => dataUrlToBuffer(d)).filter(Boolean);
    if (buffers.length < 2) return res.status(400).json({ error: 'Add at least 2 images' });
    const bufs = buffers.slice(0, 9);
    const n = bufs.length;
    const cols = clampInt(req.body?.columns, 1, 5, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    const cell = clampInt(req.body?.cellSize, 100, 1500, 400);
    const gap = clampInt(req.body?.spacing, 0, 300, 12);
    const bg = parseHexColor(req.body?.background)?.hex || '#ffffff';
    const bgRgb = parseHexColor(bg);
    const W = cols * cell + (cols + 1) * gap;
    const H = rows * cell + (rows + 1) * gap;

    const composites = [];
    for (let idx = 0; idx < n; idx += 1) {
      const resized = await sharp(bufs[idx]).rotate().resize(cell, cell, { fit: 'cover', position: 'centre' }).toBuffer();
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      composites.push({ input: resized, left: gap + c * (cell + gap), top: gap + r * (cell + gap) });
    }

    const out = await sharp({
      create: { width: W, height: H, channels: 4, background: { r: bgRgb.r, g: bgRgb.g, b: bgRgb.b, alpha: 1 } },
    }).composite(composites).png().toBuffer();

    res.json({
      ok: true,
      count: n,
      columns: cols,
      rows,
      width: W,
      height: H,
      bytes: out.length,
      imageDataUrl: `data:image/png;base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Collage failed' });
  }
});

router.post('/effect', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const meta = await sharp(buffer).metadata();
    let fmt = outputFormatFor(meta);
    const effect = String(req.body?.effect || '');
    // Bake EXIF orientation once so every effect operates on upright pixels.
    const oriented = await sharp(buffer).rotate().toBuffer();
    const om = await sharp(oriented).metadata();
    const W = om.width;
    const H = om.height;
    let pipeline;

    if (effect === 'flip-v') {
      pipeline = sharp(oriented).flip();
    } else if (effect === 'flip-h') {
      pipeline = sharp(oriented).flop();
    } else if (effect === 'rotate-90') {
      pipeline = sharp(oriented).rotate(90);
    } else if (effect === 'rotate-180') {
      pipeline = sharp(oriented).rotate(180);
    } else if (effect === 'rotate-270') {
      pipeline = sharp(oriented).rotate(270);
    } else if (effect === 'border') {
      const bw = clampInt(req.body?.borderWidth, 0, 1000, 24);
      const bc = parseHexColor(req.body?.borderColor) || { r: 255, g: 255, b: 255 };
      pipeline = sharp(oriented).extend({ top: bw, bottom: bw, left: bw, right: bw, background: { r: bc.r, g: bc.g, b: bc.b, alpha: 1 } });
    } else if (effect === 'round') {
      const radius = clampInt(req.body?.radius, 0, Math.floor(Math.min(W, H) / 2), Math.round(Math.min(W, H) * 0.08));
      const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
      pipeline = sharp(oriented).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]);
      fmt = 'png';
    } else if (effect === 'grayscale') {
      pipeline = sharp(oriented).grayscale();
    } else if (effect === 'invert') {
      pipeline = sharp(oriented).negate({ alpha: false });
    } else if (effect === 'sepia') {
      pipeline = sharp(oriented).recomb([
        [0.393, 0.769, 0.189],
        [0.349, 0.686, 0.168],
        [0.272, 0.534, 0.131],
      ]);
    } else if (effect === 'duotone') {
      const a = parseHexColor(req.body?.duoShadow) || { r: 30, g: 20, b: 64 };
      const b = parseHexColor(req.body?.duoHighlight) || { r: 255, g: 210, b: 120 };
      const grayBuf = await sharp(oriented).grayscale().toBuffer();
      const gm = await sharp(grayBuf).metadata();
      const slope = [(b.r - a.r) / 255, (b.g - a.g) / 255, (b.b - a.b) / 255];
      const inter = [a.r, a.g, a.b];
      if (gm.channels === 4) { slope.push(1); inter.push(0); }
      pipeline = sharp(grayBuf).linear(slope, inter);
    } else if (effect === 'shadow') {
      const blur = clampInt(req.body?.blur, 0, 200, 25);
      const ox = clampInt(req.body?.offsetX, -400, 400, 0);
      const oy = clampInt(req.body?.offsetY, -400, 400, 18);
      const sc = parseHexColor(req.body?.shadowColor) || { r: 0, g: 0, b: 0 };
      const sopRaw = Number(req.body?.shadowOpacity);
      const shadowAlpha = Number.isFinite(sopRaw) ? Math.min(1, Math.max(0, sopRaw)) : 0.45;
      const pad = Math.ceil(blur * 2 + Math.max(Math.abs(ox), Math.abs(oy)) + 10);
      const cw = W + pad * 2;
      const ch = H + pad * 2;
      const rect = await sharp({ create: { width: W, height: H, channels: 4, background: { r: sc.r, g: sc.g, b: sc.b, alpha: shadowAlpha } } }).png().toBuffer();
      let shadowPipe = sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: rect, left: pad + ox, top: pad + oy }]);
      if (blur >= 1) shadowPipe = shadowPipe.blur(blur);
      const shadowLayer = await shadowPipe.png().toBuffer();
      const bgColor = parseHexColor(req.body?.background);
      const baseBg = bgColor ? { r: bgColor.r, g: bgColor.g, b: bgColor.b, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };
      pipeline = sharp({ create: { width: cw, height: ch, channels: 4, background: baseBg } })
        .composite([{ input: shadowLayer, left: 0, top: 0 }, { input: oriented, left: pad, top: pad }]);
      fmt = 'png';
    } else {
      return res.status(400).json({ error: 'Unknown effect' });
    }

    const out = await pipeline.toFormat(fmt).toBuffer();
    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      effect,
      width: m2?.width || null,
      height: m2?.height || null,
      format: fmt,
      bytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Effect failed' });
  }
});

router.post('/extend', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const meta = await sharp(buffer).metadata();
    const top = clampInt(req.body?.top, 0, 5000, 0);
    const right = clampInt(req.body?.right, 0, 5000, 0);
    const bottom = clampInt(req.body?.bottom, 0, 5000, 0);
    const left = clampInt(req.body?.left, 0, 5000, 0);
    if (top + right + bottom + left === 0) {
      return res.status(400).json({ error: 'Add padding on at least one side' });
    }
    const transparent = Boolean(req.body?.transparent);
    const bg = parseHexColor(req.body?.background);
    const background = transparent
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : (bg ? { r: bg.r, g: bg.g, b: bg.b, alpha: 1 } : { r: 255, g: 255, b: 255, alpha: 1 });
    const fmt = transparent ? 'png' : outputFormatFor(meta);
    let pipeline = sharp(buffer).rotate();
    if (transparent) pipeline = pipeline.ensureAlpha();
    pipeline = pipeline.extend({ top, right, bottom, left, background });
    const out = await pipeline.toFormat(fmt).toBuffer();
    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      width: m2?.width || null,
      height: m2?.height || null,
      format: fmt,
      bytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Canvas extend failed' });
  }
});

router.post('/adjust', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const meta = await sharp(buffer).metadata();
    const fmt = outputFormatFor(meta);
    const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
    const clampNumber = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const brightness = clampNumber(num(req.body?.brightness, 1), 0.3, 2);
    const contrast = clampNumber(num(req.body?.contrast, 1), 0.3, 2);
    const saturation = clampNumber(num(req.body?.saturation, 1), 0, 2);
    const hue = clampNumber(num(req.body?.hue, 0), 0, 360);
    const sharpness = clampNumber(num(req.body?.sharpness, 0), 0, 10);
    const temperature = clampNumber(num(req.body?.temperature, 0), -100, 100);
    const vignette = clampNumber(num(req.body?.vignette, 0), 0, 100);

    const om = await sharp(buffer).rotate().metadata();
    const W = om.width;
    const H = om.height;
    let pipeline = sharp(buffer).rotate();

    const modOpts = {};
    if (brightness !== 1) modOpts.brightness = brightness;
    if (saturation !== 1) modOpts.saturation = saturation;
    if (hue) modOpts.hue = Math.round(hue);
    if (Object.keys(modOpts).length) pipeline = pipeline.modulate(modOpts);
    if (contrast !== 1) pipeline = pipeline.linear(contrast, Math.round(128 * (1 - contrast)));
    if (temperature !== 0) {
      const t = temperature / 100;
      const rMul = 1 + 0.3 * t;
      const bMul = 1 - 0.3 * t;
      pipeline = pipeline.recomb([[rMul, 0, 0], [0, 1, 0], [0, 0, bMul]]);
    }
    if (sharpness > 0) pipeline = pipeline.sharpen({ sigma: 0.5 + sharpness * 0.35 });
    if (vignette > 0) {
      const strength = (vignette / 100) * 0.85;
      const vig = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="50%" cy="50%" r="75%"><stop offset="50%" stop-color="black" stop-opacity="0"/><stop offset="100%" stop-color="black" stop-opacity="${strength.toFixed(3)}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
      pipeline = pipeline.composite([{ input: vig, blend: 'over' }]);
    }

    const out = await pipeline.toFormat(fmt).toBuffer();
    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      width: m2?.width || null,
      height: m2?.height || null,
      format: fmt,
      bytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Adjust failed' });
  }
});

router.post('/diff', async (req, res) => {
  try {
    const a = dataUrlToBuffer(req.body?.imageA || '');
    const b = dataUrlToBuffer(req.body?.imageB || '');
    if (!a || !b) return res.status(400).json({ error: 'Two valid images are required' });
    const am = await sharp(a).rotate().metadata();
    const W = am.width;
    const H = am.height;
    const ra = await sharp(a).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rb = await sharp(b).rotate().resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const threshold = clampInt(req.body?.threshold, 0, 255, 25);
    const da = ra.data;
    const db = rb.data;
    const out = Buffer.alloc(W * H * 4);
    let diffCount = 0;
    for (let i = 0; i < da.length; i += 4) {
      const maxd = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (maxd > threshold) {
        out[i] = 255; out[i + 1] = 16; out[i + 2] = 64; out[i + 3] = 255;
        diffCount += 1;
      } else {
        const gray = (da[i] + da[i + 1] + da[i + 2]) / 3;
        const dim = Math.round(gray * 0.45 + 130); // washed-out context
        out[i] = dim; out[i + 1] = dim; out[i + 2] = dim; out[i + 3] = 255;
      }
    }
    const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const total = W * H;
    res.json({
      ok: true,
      width: W,
      height: H,
      threshold,
      diffPixels: diffCount,
      diffPct: total > 0 ? Number(((diffCount / total) * 100).toFixed(2)) : 0,
      imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Diff failed' });
  }
});

module.exports = router;
