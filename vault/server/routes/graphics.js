'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const archiver = require('archiver');
const ImageTracer = require('imagetracerjs');
const exifReader = require('exif-reader');
const { runtimeConfig } = require('../config/runtime');
const { callModel } = require('../services/callModel');
const { pool } = require('../db');

// AI SVG icon generator model (Anthropic). Overridable via env.
const ICON_MODEL = process.env.GRAPHICS_ICON_MODEL || 'claude-sonnet-4-6';

// Parse model output that should be JSON but may be wrapped in prose / fences.
function safeJsonParse(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const firstArr = s.indexOf('[');
  const firstObj = s.indexOf('{');
  let start = -1;
  if (firstArr >= 0 && (firstObj < 0 || firstArr < firstObj)) start = firstArr;
  else start = firstObj;
  if (start < 0) return null;
  const end = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
  if (end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function pickOneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeIconName(name, index) {
  const cleaned = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || `icon-${index + 1}`;
}

// DOM-based SVG sanitiser. Lazy-loaded (jsdom is heavy) so it's only paid for
// when the AI icon generator actually runs.
let _svgPurify = null;
function getSvgPurify() {
  if (_svgPurify) return _svgPurify;
  const { JSDOM } = require('jsdom');
  const createDOMPurify = require('dompurify');
  _svgPurify = createDOMPurify(new JSDOM('').window);
  return _svgPurify;
}

// Last-resort regex strip, used only if jsdom/DOMPurify fails to load.
function regexStripSvg(s) {
  let out = String(s || '');
  out = out.replace(/<\?xml[\s\S]*?\?>/gi, '');
  out = out.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '');
  return out;
}

// Strip anything unsafe from model-supplied SVG before it reaches the browser.
function sanitizeSvgMarkup(svg) {
  // Isolate the <svg> element first — drops markdown, XML prologs and DOCTYPEs.
  const match = String(svg || '').match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return '';
  const raw = match[0].trim();
  try {
    const DOMPurify = getSvgPurify();
    const clean = DOMPurify.sanitize(raw, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject'],
      FORBID_ATTR: ['onload', 'onclick', 'onmouseover', 'onerror'],
    });
    return String(clean || '').trim();
  } catch {
    return regexStripSvg(raw).trim();
  }
}
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
const DEFAULT_REPLICATE_BG_MODEL = 'cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003';
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
  { id: 'ico', label: 'ICO (favicon)', mime: 'image/x-icon', ext: 'ico', lossy: false },
];

// True if the buffer looks like an HEIF/HEIC container (ISO-BMFF `ftyp` box with
// an HEIC-family brand). Used so the Convert tool can accept .heic uploads whose
// browser MIME type came through as octet-stream.
function isHeicBuffer(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = buffer.toString('ascii', 8, 12).toLowerCase();
  return ['heic', 'heix', 'heif', 'mif1', 'msf1', 'hevc', 'heim', 'heis', 'hevm', 'hevs'].includes(brand);
}

// Pack a set of PNG buffers (one per square size) into a single .ico container.
// Modern .ico supports embedded PNG data, so each entry is just the PNG bytes.
function packIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const bodies = [];
  images.forEach((img, i) => {
    const b = i * 16;
    const dim = img.size >= 256 ? 0 : img.size; // 0 means 256px
    dir.writeUInt8(dim, b + 0);
    dir.writeUInt8(dim, b + 1);
    dir.writeUInt8(0, b + 2); // palette colour count
    dir.writeUInt8(0, b + 3); // reserved
    dir.writeUInt16LE(1, b + 4); // colour planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32LE(img.buf.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += img.buf.length;
    bodies.push(img.buf);
  });
  return Buffer.concat([header, dir, ...bodies]);
}

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

async function augmentWithFal({ prompt, imageDataUrl, denoise, seed, modelName }) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY is not configured');
  if (!/^data:image\//i.test(String(imageDataUrl || ''))) {
    throw new Error('A source image is required for augmentation');
  }

  // resolveFalEndpoint appends the /image-to-image suffix for augment mode.
  const endpoint = resolveFalEndpoint(modelName, 'augment');
  const data = await fetchJson(`https://fal.run/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_url: imageDataUrl,
      strength: denoise,
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
  if (!image?.url) throw new Error('FAL did not return an augmented image');
  const outDataUrl = await imageUrlToDataUrl(image.url, image.content_type);

  return {
    seed: Number.isFinite(Number(data.seed)) ? Number(data.seed) : seed,
    image: {
      provider: 'fal',
      endpoint,
      url: image.url,
      contentType: image.content_type || 'image/jpeg',
    },
    imageDataUrl: outDataUrl,
  };
}

// Mask-based inpainting via FAL. The mask must be the same size as the image,
// white where the model should repaint, black to keep. Endpoint is overridable.
async function inpaintWithFal({ prompt, imageDataUrl, maskDataUrl, strength, seed }) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY is not configured');
  if (!/^data:image\//i.test(String(imageDataUrl || ''))) throw new Error('A source image is required for inpainting');
  if (!/^data:image\//i.test(String(maskDataUrl || ''))) throw new Error('A mask is required for inpainting');

  const endpoint = String(process.env.GRAPHICS_INPAINT_MODEL || 'fal-ai/flux-lora/inpainting').trim();
  const data = await fetchJson(`https://fal.run/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_url: imageDataUrl,
      mask_url: maskDataUrl,
      strength,
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
  if (!image?.url) throw new Error('FAL did not return an inpainted image');
  const outDataUrl = await imageUrlToDataUrl(image.url, image.content_type);
  return {
    seed: Number.isFinite(Number(data.seed)) ? Number(data.seed) : seed,
    image: { provider: 'fal', endpoint, url: image.url, contentType: image.content_type || 'image/jpeg' },
    imageDataUrl: outDataUrl,
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
    const seed = Number.isFinite(Number(req.body?.seed))
      ? Math.floor(Number(req.body.seed))
      : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const denoise = Math.max(0.15, Math.min(0.85, Number(req.body?.denoise) || 0.45));

    if (provider === 'fal') {
      const falResult = await augmentWithFal({
        prompt,
        imageDataUrl: sourceImageDataUrl,
        denoise,
        seed,
        modelName,
      });
      const cost = estimateGenerateCost({ provider: 'fal' });
      logImageUsage({ userId: req.user.id, model: `fal:${modelName}`, feature: 'graphics_augment', costUsd: cost.usd });
      return res.json({
        ok: true,
        prompt,
        seed: falResult.seed,
        denoise,
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

// Extract element: apply a painted mask as an alpha channel to isolate a region.
// Client sends: imageDataUrl + maskDataUrl (white=keep, black=remove) + optional feather.
router.post('/extract', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const maskDataUrl = String(req.body?.maskDataUrl || '');
    const feather = Math.min(50, Math.max(0, Number(req.body?.feather) || 0));
    const imgBuf = dataUrlToBuffer(imageDataUrl);
    const maskBuf = dataUrlToBuffer(maskDataUrl);
    if (!imgBuf || !maskBuf) return res.status(400).json({ error: 'Both image and mask are required' });

    const meta = await sharp(imgBuf).metadata();
    const W = meta.width;
    const H = meta.height;

    // Resize mask to match image, convert to greyscale, optionally blur for feathering.
    let maskPipeline = sharp(maskBuf).resize(W, H, { fit: 'fill' }).greyscale();
    if (feather > 0) maskPipeline = maskPipeline.blur(feather);
    const { data: maskData } = await maskPipeline.raw().toBuffer({ resolveWithObject: true });

    // Ensure image has alpha, then multiply existing alpha by mask value.
    const { data: imgData, info } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const nPixels = info.width * info.height;
    const out = Buffer.alloc(nPixels * 4);
    for (let i = 0; i < nPixels; i++) {
      out[i * 4]     = imgData[i * 4];
      out[i * 4 + 1] = imgData[i * 4 + 1];
      out[i * 4 + 2] = imgData[i * 4 + 2];
      out[i * 4 + 3] = Math.round(imgData[i * 4 + 3] * (maskData[i] / 255));
    }
    const resultBuf = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    res.json({ imageDataUrl: `data:image/png;base64,${resultBuf.toString('base64')}`, width: info.width, height: info.height });
  } catch (err) {
    console.error('extract error:', err);
    res.status(500).json({ error: err.message || 'Extraction failed' });
  }
});

// Mask-based inpainting / object removal. Currently FAL-only (mask + prompt).
router.post('/inpaint', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Describe what should fill the masked area' });
    const sourceImageDataUrl = String(req.body?.imageDataUrl || '');
    const maskDataUrl = String(req.body?.maskDataUrl || '');
    if (!/^data:image\//i.test(sourceImageDataUrl)) return res.status(400).json({ error: 'A valid image is required' });
    if (!/^data:image\//i.test(maskDataUrl)) return res.status(400).json({ error: 'Paint a mask over the area to change' });

    const restrictions = await loadContentRestrictions();
    const modelName = await resolveGraphicsModel(req.user.id);
    const provider = await resolveGraphicsProvider(req.user.id, modelName);
    if (provider !== 'fal') {
      return res.status(400).json({ error: 'Inpainting currently requires the FAL provider. Switch your image provider in Settings.' });
    }
    const seed = Number.isFinite(Number(req.body?.seed)) ? Math.floor(Number(req.body.seed)) : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const strength = Math.max(0.3, Math.min(1, Number(req.body?.strength) || 0.85));

    const result = await inpaintWithFal({ prompt, imageDataUrl: sourceImageDataUrl, maskDataUrl, strength, seed });
    const cost = estimateGenerateCost({ provider: 'fal' });
    logImageUsage({ userId: req.user.id, model: `fal:${result.image.endpoint}`, feature: 'graphics_inpaint', costUsd: cost.usd });
    res.json({
      ok: true,
      prompt,
      seed: result.seed,
      strength,
      model: result.image.endpoint,
      cost,
      image: result.image,
      imageDataUrl: result.imageDataUrl,
      restrictions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Inpainting failed' });
  }
});

// Deterministic multi-step pipeline: apply a whitelisted sequence of sharp ops.
const PIPELINE_OPS = ['grayscale', 'sepia', 'invert', 'blur', 'sharpen', 'brightness', 'contrast', 'saturation', 'gamma', 'rotate', 'flip', 'flop', 'resize', 'border', 'temperature'];

async function applyPipelineStep(buffer, step) {
  const op = String(step?.op || '');
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let pipe = sharp(buffer).rotate();
  switch (op) {
    case 'grayscale': pipe = pipe.grayscale(); break;
    case 'invert': pipe = pipe.negate({ alpha: false }); break;
    case 'sepia': pipe = pipe.recomb([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]); break;
    case 'blur': pipe = pipe.blur(clamp(num(step.value, 5), 0.3, 60)); break;
    case 'sharpen': pipe = pipe.sharpen({ sigma: clamp(num(step.value, 2), 0.3, 10) }); break;
    case 'brightness': pipe = pipe.modulate({ brightness: clamp(num(step.value, 1), 0.3, 2) }); break;
    case 'saturation': pipe = pipe.modulate({ saturation: clamp(num(step.value, 1), 0, 2) }); break;
    case 'contrast': { const c = clamp(num(step.value, 1), 0.3, 2); pipe = pipe.linear(c, Math.round(128 * (1 - c))); break; }
    case 'gamma': pipe = pipe.gamma(clamp(num(step.value, 1), 1, 3)); break;
    case 'rotate': { const a = clamp(num(step.value, 90), -180, 180); pipe = pipe.rotate(a, { background: { r: 255, g: 255, b: 255, alpha: 1 } }); break; }
    case 'flip': pipe = pipe.flip(); break;
    case 'flop': pipe = pipe.flop(); break;
    case 'temperature': { const t = clamp(num(step.value, 0), -100, 100) / 100; pipe = pipe.recomb([[1 + 0.3 * t, 0, 0], [0, 1, 0], [0, 0, 1 - 0.3 * t]]); break; }
    case 'resize': {
      const w = clampInt(step.width, 1, 12000, undefined);
      const h = clampInt(step.height, 1, 12000, undefined);
      const fit = ['cover', 'contain', 'fill', 'inside', 'outside'].includes(step.fit) ? step.fit : 'inside';
      if (w || h) pipe = pipe.resize({ width: w, height: h, fit });
      break;
    }
    case 'border': {
      const bw = clampInt(step.value, 0, 1000, 24);
      const bc = parseHexColor(step.color) || { r: 255, g: 255, b: 255 };
      pipe = pipe.extend({ top: bw, bottom: bw, left: bw, right: bw, background: { r: bc.r, g: bc.g, b: bc.b, alpha: 1 } });
      break;
    }
    default: return buffer;
  }
  return pipe.toBuffer();
}

router.post('/pipeline', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    let buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) return res.status(400).json({ error: 'A valid image is required' });
    const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
    if (!steps.length) return res.status(400).json({ error: 'Add at least one step' });
    const valid = steps.filter((s) => PIPELINE_OPS.includes(String(s?.op)));
    if (!valid.length) return res.status(400).json({ error: 'No recognised steps' });
    if (valid.length > 12) return res.status(400).json({ error: 'Too many steps (max 12)' });

    const meta = await sharp(buffer).metadata();
    const fmt = outputFormatFor(meta);
    for (const step of valid) {
      // eslint-disable-next-line no-await-in-loop
      buffer = await applyPipelineStep(buffer, step);
    }
    const out = await sharp(buffer).toFormat(fmt).toBuffer();
    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      steps: valid.length,
      width: m2?.width || null,
      height: m2?.height || null,
      format: fmt,
      bytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Pipeline failed' });
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
    const heic = isHeicBuffer(buffer);
    if (!buffer || (!/^data:image\//i.test(imageDataUrl) && !heic)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }

    const requested = String(req.body?.format || '').trim().toLowerCase();
    const target = CONVERT_FORMATS.find((f) => f.id === requested || f.ext === requested || (requested === 'jpg' && f.id === 'jpeg'));
    if (!target) {
      return res.status(400).json({ error: `Unsupported target format. Choose one of: ${CONVERT_FORMATS.map((f) => f.id).join(', ')}` });
    }

    // HEIC decoding depends on the installed libvips having an HEIF decoder.
    // Probe early so we can return a friendly message instead of a raw error.
    if (heic) {
      try {
        await sharp(buffer).metadata();
      } catch {
        return res.status(415).json({ error: 'This server build can’t read HEIC/HEIF images. Convert to JPG/PNG on your device first.' });
      }
    }

    // ICO is packed by hand (sharp can't write it): render square PNGs at the
    // standard icon sizes and stitch them into one multi-resolution .ico.
    if (target.id === 'ico') {
      const oriented = await sharp(buffer).rotate().toBuffer();
      const icoSizes = [16, 32, 48, 64, 128, 256];
      const pngs = [];
      for (const s of icoSizes) {
        // eslint-disable-next-line no-await-in-loop
        const png = await sharp(oriented).resize(s, s, { fit: 'cover', position: 'centre' }).png().toBuffer();
        pngs.push({ size: s, buf: png });
      }
      const ico = packIco(pngs);
      return res.json({
        ok: true,
        format: 'ico',
        mime: target.mime,
        ext: target.ext,
        quality: null,
        width: 256,
        height: 256,
        bytes: ico.length,
        imageDataUrl: `data:${target.mime};base64,${ico.toString('base64')}`,
      });
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

  // cjwbw/rembg and similar versioned models use "owner/name:version_hash" format.
  // Unversioned models (owner/name only) use the /models/ deployment endpoint.
  let url, body;
  if (model.includes(':')) {
    url = 'https://api.replicate.com/v1/predictions';
    body = { version: model.split(':')[1], input: { image: imageDataUrl } };
  } else {
    url = `https://api.replicate.com/v1/models/${model}/predictions`;
    body = { input: { image: imageDataUrl } };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify(body),
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
    const bgImageDataUrl = String(req.body?.backgroundImageDataUrl || '');
    const bgImageBuffer = bgImageDataUrl ? dataUrlToBuffer(bgImageDataUrl) : null;
    if (bgImageDataUrl && !bgImageBuffer) {
      return res.status(400).json({ error: 'The background image is not a valid image' });
    }

    let gradient = null;
    if (req.body?.gradient && typeof req.body.gradient === 'object') {
      const from = parseHexColor(req.body.gradient.from);
      const to = parseHexColor(req.body.gradient.to);
      if (!from || !to) {
        return res.status(400).json({ error: 'Gradient colours must be valid hex values' });
      }
      const allowedDirs = ['to-bottom', 'to-top', 'to-right', 'to-left', 'to-bottom-right', 'to-bottom-left', 'radial'];
      const direction = allowedDirs.includes(req.body.gradient.direction) ? req.body.gradient.direction : 'to-bottom';
      gradient = { from: from.hex, to: to.hex, direction };
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

    let outBuffer;
    if (bgImageBuffer) {
      // Composite the transparent cut-out over a supplied image, scaled to cover.
      const cm = await sharp(cutoutBuffer).metadata();
      const resizedBg = await sharp(bgImageBuffer)
        .rotate()
        .resize(cm.width, cm.height, { fit: 'cover', position: 'centre' })
        .toBuffer();
      const cutoutPng = await sharp(cutoutBuffer).png().toBuffer();
      outBuffer = await sharp(resizedBg).composite([{ input: cutoutPng }]).png().toBuffer();
    } else if (gradient) {
      // Composite the cut-out over a generated two-colour gradient sized to the subject.
      const cm = await sharp(cutoutBuffer).metadata();
      const W = cm.width || 1024;
      const H = cm.height || 1024;
      const dirCoords = {
        'to-bottom': { x1: 0, y1: 0, x2: 0, y2: 1 },
        'to-top': { x1: 0, y1: 1, x2: 0, y2: 0 },
        'to-right': { x1: 0, y1: 0, x2: 1, y2: 0 },
        'to-left': { x1: 1, y1: 0, x2: 0, y2: 0 },
        'to-bottom-right': { x1: 0, y1: 0, x2: 1, y2: 1 },
        'to-bottom-left': { x1: 1, y1: 0, x2: 0, y2: 1 },
      };
      let defs;
      if (gradient.direction === 'radial') {
        defs = `<radialGradient id="g" cx="50%" cy="50%" r="75%"><stop offset="0%" stop-color="${gradient.from}"/><stop offset="100%" stop-color="${gradient.to}"/></radialGradient>`;
      } else {
        const c = dirCoords[gradient.direction] || dirCoords['to-bottom'];
        defs = `<linearGradient id="g" x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}"><stop offset="0%" stop-color="${gradient.from}"/><stop offset="100%" stop-color="${gradient.to}"/></linearGradient>`;
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}</defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`;
      const gradientBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
      const cutoutPng = await sharp(cutoutBuffer).png().toBuffer();
      outBuffer = await sharp(gradientBuffer).composite([{ input: cutoutPng }]).png().toBuffer();
    } else if (bgColor) {
      outBuffer = await sharp(cutoutBuffer).flatten({ background: { r: bgColor.r, g: bgColor.g, b: bgColor.b } }).png().toBuffer();
    } else {
      outBuffer = await sharp(cutoutBuffer).png().toBuffer();
    }
    const meta = await sharp(outBuffer).metadata().catch(() => null);

    res.json({
      ok: true,
      provider,
      background: bgImageBuffer ? 'image' : (gradient ? `gradient ${gradient.from} → ${gradient.to}` : (bgColor ? bgColor.hex : 'transparent')),
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

// Raster -> SVG vectorisation (tracing). Best for logos, icons and flat
// clipart; photos become stylised. Uses imagetracerjs over sharp-decoded
// pixels; the image is capped in size first so tracing stays fast.
router.post('/vectorize', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const colors = clampInt(req.body?.colors, 2, 64, 16);
    const detail = String(req.body?.detail || 'medium');
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize(700, 700, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const imgd = {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    };
    const presets = {
      smooth: { ltres: 1, qtres: 1, pathomit: 8, blurradius: 2, blurdelta: 20 },
      medium: { ltres: 1, qtres: 1, pathomit: 8 },
      detailed: { ltres: 0.5, qtres: 0.5, pathomit: 1 },
    };
    const opts = { numberofcolors: colors, ...(presets[detail] || presets.medium) };
    const svg = ImageTracer.imagedataToSVG(imgd, opts);
    const base64 = Buffer.from(svg, 'utf8').toString('base64');
    res.json({
      ok: true,
      width: info.width,
      height: info.height,
      colors,
      bytes: Buffer.byteLength(svg, 'utf8'),
      svg,
      imageDataUrl: `data:image/svg+xml;base64,${base64}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Vectorize failed' });
  }
});

// AI icon generator — step 1: suggest relevant reference icons for a subject.
router.post('/icon-references', async (req, res) => {
  try {
    const subject = String(req.body?.subject || '').trim().slice(0, 80);
    if (!subject) return res.status(400).json({ error: 'A subject is required' });
    const system = 'You suggest names of icons that already exist in popular icon libraries. Respond with ONLY minified JSON, no markdown, no commentary.';
    const prompt = `Suggest icons relevant to the subject "${subject}".
Return JSON exactly like: {"lucide":["wallet","credit-card"],"fontawesome":["wallet","chart-line"]}
- "lucide": 12 real lucide-react icon names in kebab-case that genuinely exist.
- "fontawesome": 8 real Font Awesome 6 Free *solid* icon names (the bare name, no "fa-" prefix) that genuinely exist.
No duplicates, no made-up names.`;
    const text = await callModel(ICON_MODEL, prompt, { maxTokens: 600, system });
    const parsed = safeJsonParse(text) || {};
    const clean = (arr) => (Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().toLowerCase().replace(/^fa-/, '')) : []);
    res.json({
      ok: true,
      subject,
      lucide: [...new Set(clean(parsed.lucide))].slice(0, 16),
      fontawesome: [...new Set(clean(parsed.fontawesome))].slice(0, 16),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Icon suggestion failed' });
  }
});

// AI icon generator — step 2: generate a cohesive SVG icon set.
router.post('/icon-generate', async (req, res) => {
  try {
    const subject = String(req.body?.subject || '').trim().slice(0, 80);
    if (!subject) return res.status(400).json({ error: 'A subject is required' });
    const count = clampInt(req.body?.count, 5, 20, 10);
    const parsedColor = parseHexColor(req.body?.color);
    const color = parsedColor ? parsedColor.hex : '#111111';
    const references = Array.isArray(req.body?.references)
      ? req.body.references.filter((s) => typeof s === 'string').slice(0, 12)
      : [];
    const strokeWeight = pickOneOf(req.body?.strokeWeight, ['super-thin', 'thin', 'regular', 'bold'], 'regular');
    const fillStyle = pickOneOf(req.body?.fillStyle, ['outlined', 'filled', 'duotone'], 'outlined');
    const corners = pickOneOf(req.body?.corners, ['sharp', 'slightly-rounded', 'fully-rounded'], 'slightly-rounded');
    const detail = pickOneOf(req.body?.detail, ['simple', 'medium', 'detailed'], 'medium');
    const existing = Array.isArray(req.body?.existing)
      ? req.body.existing.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, 40)
      : [];
    const feedback = String(req.body?.feedback || '').trim().slice(0, 600);
    const strokeMap = { 'super-thin': 1, thin: 1.5, regular: 2, bold: 3 };
    const linejoin = corners === 'sharp' ? 'miter' : 'round';

    let styleRule;
    if (fillStyle === 'outlined') {
      styleRule = `Outlined: stroke="${color}", fill="none", stroke-width="${strokeMap[strokeWeight]}", stroke-linecap="${corners === 'sharp' ? 'butt' : 'round'}", stroke-linejoin="${linejoin}".`;
    } else if (fillStyle === 'filled') {
      styleRule = `Filled: solid fill="${color}", no stroke.`;
    } else {
      styleRule = `Duotone: primary shapes fill="${color}"; secondary shapes use the same colour at fill-opacity="0.35".`;
    }

    const continuation = existing.length
      ? `\nThis is an addition to an EXISTING set. Already in the set (do NOT repeat or duplicate these): ${existing.join(', ')}.\nGenerate ${count} brand-new icons that match the same visual style, weight and theme as the existing set, and fill obvious gaps.`
      : '';
    const refinement = feedback
      ? `\nUser refinement request — honour this closely: ${feedback}`
      : '';

    const system = `You are a senior icon designer at a world-class design studio. Every icon you create is a small act of visual craft, not a task to complete.
Before drawing each icon, ask yourself: what is the most elegant, non-literal way to represent this concept? Avoid the first obvious interpretation. A bank doesn't need columns. A wallet doesn't need stitching.
Apply these principles to every icon:
- Use the fewest paths necessary. If a shape can be suggested rather than fully drawn, prefer suggestion.
- Treat negative space as deliberately as the paths themselves. The space inside and around the icon is part of the design.
- Ensure consistent optical weight across the set. Every icon must feel like it belongs to the same family — same level of abstraction, same visual tension, same relationship between form and space.
- Make optical corrections where needed. Circles should appear visually equal to squares, not mathematically equal.
- Every path must earn its place. If removing it doesn't break the meaning, remove it.
Before finalising each icon, ask: does this look like it was designed, or does it look like it was generated? If you can't tell the difference, redesign it.
Output ONLY raw JSON. No markdown, no code fences, no commentary.`;
    const prompt = `Design a cohesive set of ${count} SVG icons for the subject "${subject}".
Emulate the visual style of these reference icons: ${references.join(', ') || 'clean, modern line icons'}.${continuation}${refinement}
Rules for EVERY icon:
- Root <svg> with xmlns="http://www.w3.org/2000/svg" and viewBox="0 0 24 24" (no width/height).
- ${styleRule}
- Corner feel: ${corners.replace('-', ' ')}. Detail level: ${detail}.
- Consistent visual weight, proportions and padding across the whole set.
- Self-contained, valid SVG only: no <script>, no <image>, no external references, no <style> blocks.
Return ONLY a JSON array of exactly ${count} objects:
[{"name":"short-kebab-name","svg":"<svg ...>...</svg>"}]
Names must be unique, lowercase, kebab-case, and describe the icon.`;

    const maxTokens = Math.min(8000, 1500 + count * 380);
    const result = await callModel(ICON_MODEL, prompt, { maxTokens, system, returnUsage: true });
    const raw = typeof result === 'string' ? result : result.text;
    const arr = safeJsonParse(raw);
    if (!Array.isArray(arr)) throw new Error('The model did not return an icon set — try again');
    const icons = arr
      .map((o, i) => ({ name: sanitizeIconName(o?.name, i), svg: sanitizeSvgMarkup(o?.svg) }))
      .filter((o) => o.svg)
      .slice(0, count);
    if (!icons.length) throw new Error('No valid icons were produced — try again');

    res.json({ ok: true, subject, count: icons.length, color, icons });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Icon generation failed' });
  }
});

function gpsToDecimal(parts, ref) {
  if (!Array.isArray(parts) || parts.length < 3) return null;
  const [d, m, s] = parts.map(Number);
  let dec = d + m / 60 + s / 3600;
  if (ref === 'S' || ref === 'W') dec = -dec;
  return Number.isFinite(dec) ? dec : null;
}

function formatExif(buffer) {
  let parsed;
  try { parsed = exifReader(buffer); } catch { return []; }
  if (!parsed) return [];
  const image = parsed.Image || {};
  const photo = parsed.Photo || {};
  const gps = parsed.GPSInfo || parsed.GPS || {};
  const fields = [];
  const push = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    fields.push({ label, value: value instanceof Date ? value.toISOString().replace('T', ' ').replace(/\..+/, '') : String(value) });
  };
  push('Camera make', image.Make);
  push('Camera model', image.Model);
  push('Lens', photo.LensModel);
  push('Software', image.Software);
  if (photo.FNumber) push('Aperture', `f/${photo.FNumber}`);
  if (photo.ExposureTime) push('Shutter', photo.ExposureTime < 1 ? `1/${Math.round(1 / photo.ExposureTime)} s` : `${photo.ExposureTime} s`);
  const iso = Array.isArray(photo.ISOSpeedRatings) ? photo.ISOSpeedRatings[0] : photo.ISOSpeedRatings;
  if (iso) push('ISO', iso);
  if (photo.FocalLength) push('Focal length', `${photo.FocalLength} mm`);
  push('Taken', photo.DateTimeOriginal || image.DateTime);
  const lat = gpsToDecimal(gps.GPSLatitude, gps.GPSLatitudeRef);
  const lon = gpsToDecimal(gps.GPSLongitude, gps.GPSLongitudeRef);
  if (lat != null && lon != null) push('GPS', `${lat.toFixed(6)}, ${lon.toFixed(6)}`);
  return fields;
}

router.post('/metadata', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const meta = await sharp(buffer).metadata();
    const basics = [];
    basics.push({ label: 'Format', value: String(meta.format || '').toUpperCase() });
    if (meta.width && meta.height) basics.push({ label: 'Dimensions', value: `${meta.width} × ${meta.height} px` });
    if (meta.space) basics.push({ label: 'Colour space', value: meta.space });
    if (meta.channels) basics.push({ label: 'Channels', value: `${meta.channels}${meta.hasAlpha ? ' (with alpha)' : ''}` });
    if (meta.density) basics.push({ label: 'Density', value: `${meta.density} DPI` });
    if (meta.orientation) basics.push({ label: 'Orientation', value: meta.orientation });
    const exif = meta.exif ? formatExif(meta.exif) : [];
    res.json({
      ok: true,
      basics,
      exif,
      hasExif: exif.length > 0,
      flags: {
        exif: Boolean(meta.exif),
        gps: Boolean(meta.exif && Buffer.isBuffer(meta.exif) && meta.exif.includes('GPS')),
        xmp: Boolean(meta.xmp),
        iptc: Boolean(meta.iptc),
        icc: Boolean(meta.icc),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not read metadata' });
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
    } else if (effect === 'rotate-free') {
      const angle = Math.max(-180, Math.min(180, Number(req.body?.angle) || 0));
      const transparent = Boolean(req.body?.transparent);
      const bg = parseHexColor(req.body?.background) || { r: 255, g: 255, b: 255 };
      const background = transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: bg.r, g: bg.g, b: bg.b, alpha: 1 };
      pipeline = sharp(oriented).rotate(angle, { background });
      if (transparent) fmt = 'png';
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
    // Levels (black/white point + gamma), blur and denoise.
    const blackPoint = clampNumber(num(req.body?.blackPoint, 0), 0, 254);
    const whitePoint = clampNumber(num(req.body?.whitePoint, 255), Math.max(1, blackPoint + 1), 255);
    const gamma = clampNumber(num(req.body?.gamma, 1), 1, 3);
    const blur = clampNumber(num(req.body?.blur, 0), 0, 30);
    const denoise = Math.round(clampNumber(num(req.body?.denoise, 0), 0, 13));

    const om = await sharp(buffer).rotate().metadata();
    const W = om.width;
    const H = om.height;
    let pipeline = sharp(buffer).rotate();

    const modOpts = {};
    if (brightness !== 1) modOpts.brightness = brightness;
    if (saturation !== 1) modOpts.saturation = saturation;
    if (hue) modOpts.hue = Math.round(hue);
    if (Object.keys(modOpts).length) pipeline = pipeline.modulate(modOpts);
    // Fold levels (black/white point) and contrast into a single linear map so
    // sharp doesn't drop one when .linear is configured more than once.
    const hasLevels = blackPoint > 0 || whitePoint < 255;
    if (contrast !== 1 || hasLevels) {
      const aL = 255 / (whitePoint - blackPoint);
      const bL = -aL * blackPoint;
      const a = contrast * aL;
      const b = contrast * bL + 128 * (1 - contrast);
      pipeline = pipeline.linear(a, Math.round(b));
    }
    if (gamma !== 1) pipeline = pipeline.gamma(gamma);
    if (temperature !== 0) {
      const t = temperature / 100;
      const rMul = 1 + 0.3 * t;
      const bMul = 1 - 0.3 * t;
      pipeline = pipeline.recomb([[rMul, 0, 0], [0, 1, 0], [0, 0, bMul]]);
    }
    if (denoise >= 1) pipeline = pipeline.median(denoise % 2 === 0 ? denoise + 1 : denoise);
    if (blur > 0) pipeline = pipeline.blur(0.3 + blur);
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

// Reject obviously-internal hosts to limit SSRF when importing an image by URL.
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]); const b = Number(m[2]);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

// Import an image by URL (server-side fetch avoids browser CORS). Returns a data URL.
router.post('/fetch-url', async (req, res) => {
  try {
    const raw = String(req.body?.url || '').trim();
    let parsed;
    try { parsed = new URL(raw); } catch { return res.status(400).json({ error: 'Enter a valid URL' }); }
    if (!/^https?:$/.test(parsed.protocol)) return res.status(400).json({ error: 'Only http(s) URLs are allowed' });
    if (isPrivateHost(parsed.hostname)) return res.status(400).json({ error: 'That host is not allowed' });
    if (typeof fetch !== 'function') return res.status(501).json({ error: 'URL import needs Node 18+' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let resp;
    try {
      resp = await fetch(raw, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': 'CuramVault/1.0', accept: 'image/*' } });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return res.status(400).json({ error: `Could not fetch image (HTTP ${resp.status})` });
    const ct = String(resp.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (!ct.startsWith('image/')) return res.status(400).json({ error: `That URL is not an image (${ct || 'unknown type'})` });
    const buf = Buffer.from(await resp.arrayBuffer());
    const MAX = 25 * 1024 * 1024;
    if (buf.length > MAX) return res.status(400).json({ error: 'Image is too large (max 25MB)' });
    if (!buf.length) return res.status(400).json({ error: 'The URL returned an empty image' });
    const name = decodeURIComponent((parsed.pathname.split('/').pop() || '').trim()) || 'image';
    res.json({ ok: true, name, bytes: buf.length, imageDataUrl: `data:${ct};base64,${buf.toString('base64')}` });
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'Fetching the image timed out' : (err.message || 'Fetch failed');
    res.status(500).json({ error: msg });
  }
});

// Build an animated GIF from a series of frames. Uses the pure-JS `gifenc`
// encoder, lazily required so the app still boots if it isn't installed.
router.post('/animate', async (req, res) => {
  try {
    const frames = Array.isArray(req.body?.frames) ? req.body.frames : [];
    if (frames.length < 2) return res.status(400).json({ error: 'Add at least 2 frames' });

    let gifenc;
    try {
      // eslint-disable-next-line global-require
      gifenc = require('gifenc');
    } catch {
      return res.status(501).json({ error: 'The Animate tool needs the gifenc package — run npm install in the vault folder.' });
    }
    const { GIFEncoder, quantize, applyPalette } = gifenc;

    const delay = clampInt(req.body?.delay, 20, 5000, 200);
    const loopForever = req.body?.loop !== false;

    const firstBuf = dataUrlToBuffer(frames[0]);
    if (!firstBuf) return res.status(400).json({ error: 'The first frame is not a valid image' });
    const fm = await sharp(firstBuf).rotate().metadata();
    let W = fm.width || 480;
    let H = fm.height || 480;
    const cap = 800;
    if (Math.max(W, H) > cap) {
      const s = cap / Math.max(W, H);
      W = Math.max(1, Math.round(W * s));
      H = Math.max(1, Math.round(H * s));
    }

    const enc = GIFEncoder();
    let written = 0;
    for (const frame of frames) {
      const b = dataUrlToBuffer(frame);
      if (!b) continue;
      // eslint-disable-next-line no-await-in-loop
      const { data } = await sharp(b).rotate().resize(W, H, { fit: 'cover', position: 'centre' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const rgba = new Uint8Array(data.buffer, data.byteOffset, data.length);
      const palette = quantize(rgba, 256);
      const index = applyPalette(rgba, palette);
      const opts = { palette, delay };
      if (written === 0) opts.repeat = loopForever ? 0 : -1;
      enc.writeFrame(index, W, H, opts);
      written += 1;
    }
    if (written < 2) return res.status(400).json({ error: 'Could not read enough valid frames' });
    enc.finish();
    const bytes = Buffer.from(enc.bytes());
    res.json({
      ok: true,
      width: W,
      height: H,
      frames: written,
      bytes: bytes.length,
      imageDataUrl: `data:image/gif;base64,${bytes.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Animation failed' });
  }
});

// Blur detection using Laplacian variance. Lower variance = blurrier image.
router.post('/blur-detect', async (req, res) => {
  try {
    const buf = dataUrlToBuffer(req.body?.imageDataUrl || '');
    if (!buf) return res.status(400).json({ error: 'No valid image provided' });

    const img = sharp(buf).rotate();
    const meta = await img.metadata();
    let w = meta.width || 1;
    let h = meta.height || 1;
    
    // Cap analysis at 800px for speed.
    const cap = 800;
    if (Math.max(w, h) > cap) {
      const s = cap / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }

    // Convert to grayscale for edge detection.
    const gray = await img
      .resize(w, h, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Apply 3x3 Laplacian kernel for edge detection.
    const data = gray.data;
    const stride = gray.info.width;
    let lapSum = 0;
    let count = 0;

    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * stride + x;
        const lap = 
          -1 * data[i - stride - 1] + -1 * data[i - stride] + -1 * data[i - stride + 1]
          + -1 * data[i - 1] + 8 * data[i] + -1 * data[i + 1]
          + -1 * data[i + stride - 1] + -1 * data[i + stride] + -1 * data[i + stride + 1];
        lapSum += lap * lap;
        count += 1;
      }
    }

    const variance = count > 0 ? lapSum / count : 0;
    let status = 'sharp';
    if (variance < 100) status = 'blurry';
    else if (variance < 500) status = 'soft';

    res.json({
      ok: true,
      variance: Number(variance.toFixed(2)),
      status,
      width: meta.width,
      height: meta.height,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Blur detection failed' });
  }
});

// Auto-enhance: intelligently adjust brightness, contrast, saturation based on histogram.
router.post('/auto-enhance', async (req, res) => {
  try {
    const buf = dataUrlToBuffer(req.body?.imageDataUrl || '');
    if (!buf) return res.status(400).json({ error: 'No valid image provided' });

    // Analyze histogram to determine optimal adjustments.
    const img = sharp(buf).rotate();
    const meta = await img.metadata();
    let w = meta.width || 1;
    let h = meta.height || 1;

    // Cap analysis at 800px.
    const cap = 800;
    if (Math.max(w, h) > cap) {
      const s = cap / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }

    // Get pixel data for histogram analysis.
    const raw = await img
      .resize(w, h, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const data = raw.data;
    const r = new Array(256).fill(0);
    const g = new Array(256).fill(0);
    const b = new Array(256).fill(0);

    // Tally per-channel histograms.
    for (let i = 0; i < data.length; i += 4) {
      r[data[i]] += 1;
      g[data[i + 1]] += 1;
      b[data[i + 2]] += 1;
    }

    // Find 5th and 95th percentiles for each channel to detect shadows/highlights.
    const percentile = (hist, p) => {
      const total = hist.reduce((a, v) => a + v, 0);
      const target = total * p;
      let sum = 0;
      for (let i = 0; i < 256; i += 1) {
        sum += hist[i];
        if (sum >= target) return i;
      }
      return 255;
    };

    const r5 = percentile(r, 0.05);
    const r95 = percentile(r, 0.95);
    const g5 = percentile(g, 0.05);
    const g95 = percentile(g, 0.95);
    const b5 = percentile(b, 0.05);
    const b95 = percentile(b, 0.95);

    // Compute adjustments: contrast stretches dark/light points, brightness shifts midtones.
    const rMid = (r5 + r95) / 2;
    const gMid = (g5 + g95) / 2;
    const bMid = (b5 + b95) / 2;
    const overall = (rMid + gMid + bMid) / 3;

    let brightness = 1;
    let contrast = 1;
    let saturation = 1;

    if (overall < 80) brightness = 1.2; // Image is dark
    else if (overall > 180) brightness = 0.9; // Image is bright

    const range = (r95 - r5 + g95 - g5 + b95 - b5) / 3;
    if (range < 100) contrast = 1.3; // Low contrast
    if (range > 200) saturation = 1.15; // Boost already-vibrant images

    // Apply adjustments via sharp: linear contrast, then manipulate saturation.
    const enhanced = await img
      .linear(contrast, Math.round(128 * (1 - contrast)))
      .modulate({ brightness, saturation })
      .png()
      .toBuffer();

    res.json({
      ok: true,
      imageDataUrl: `data:image/png;base64,${enhanced.toString('base64')}`,
      applied: { brightness: Number(brightness.toFixed(2)), contrast: Number(contrast.toFixed(2)), saturation: Number(saturation.toFixed(2)) },
      width: meta.width,
      height: meta.height,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Auto-enhance failed' });
  }
});

// Perspective correction via affine shear (handles keystone / trapezoid distortion).
// hSkew and vSkew are in the range -50…50 (percentage), normalised to -0.5…0.5 for the matrix.
router.post('/perspective', async (req, res) => {
  try {
    const buf = dataUrlToBuffer(req.body?.imageDataUrl || '');
    if (!buf) return res.status(400).json({ error: 'No valid image provided' });

    const hSkew = Math.max(-0.5, Math.min(0.5, Number(req.body?.hSkew || 0) / 100));
    const vSkew = Math.max(-0.5, Math.min(0.5, Number(req.body?.vSkew || 0) / 100));
    const bgColor = String(req.body?.background || 'transparent');

    const bg = bgColor === 'transparent'
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : (() => {
          const c = parseHexColor(bgColor);
          return c ? { r: c.r, g: c.g, b: c.b, alpha: 1 } : { r: 255, g: 255, b: 255, alpha: 1 };
        })();

    const out = await sharp(buf)
      .rotate()
      .affine([[1, hSkew], [vSkew, 1]], { background: bg, interpolator: sharp.interpolators.nohalo })
      .png()
      .toBuffer();

    const m = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      imageDataUrl: `data:image/png;base64,${out.toString('base64')}`,
      width: m?.width,
      height: m?.height,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Perspective correction failed' });
  }
});

// Smart crop — resize to a target size or aspect ratio using a chosen focus strategy.
// focus: 'attention' (content-aware), 'entropy' (high-detail region), or a cardinal direction.
const SC_FOCUS_POSITIONS = ['attention', 'entropy', 'centre', 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'];

router.post('/smart-crop', async (req, res) => {
  try {
    const buf = dataUrlToBuffer(req.body?.imageDataUrl || '');
    if (!buf) return res.status(400).json({ error: 'No valid image provided' });

    const focus = SC_FOCUS_POSITIONS.includes(req.body?.focus) ? req.body.focus : 'attention';
    let width = clampInt(req.body?.width, 1, 8000, null);
    let height = clampInt(req.body?.height, 1, 8000, null);

    const meta = await sharp(buf).rotate().metadata();
    const origW = meta.width;
    const origH = meta.height;
    const fmt = outputFormatFor(meta);

    // Resolve dimensions from aspect ratio when explicit w/h are not both given.
    const aspect = req.body?.aspect ? parseAspect(req.body.aspect) : null;
    if (aspect) {
      if (width && !height) {
        height = Math.max(1, Math.round(width * aspect.h / aspect.w));
      } else if (!width && height) {
        width = Math.max(1, Math.round(height * aspect.w / aspect.h));
      } else if (!width && !height) {
        const fromH = Math.round(origW * aspect.h / aspect.w);
        if (fromH <= origH) { width = origW; height = fromH; }
        else { height = origH; width = Math.max(1, Math.round(origH * aspect.w / aspect.h)); }
      }
    }

    if (!width && !height) {
      return res.status(400).json({ error: 'Provide a target width, height, or aspect ratio' });
    }

    const out = await sharp(buf)
      .rotate()
      .resize(width || null, height || null, { fit: 'cover', position: focus })
      .toFormat(fmt)
      .toBuffer();

    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      focus,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
      width: m2?.width,
      height: m2?.height,
      format: fmt,
      bytes: out.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Smart crop failed' });
  }
});

// Color grading — apply a named look via channel recombination, modulate and linear tone mapping.
const COLORGRADE_PRESETS = {
  warm:        { label: 'Warm',          recomb: [[1.15, 0.05, 0], [0, 1.0, 0], [0, 0, 0.85]], saturation: 1.1 },
  cool:        { label: 'Cool',          recomb: [[0.85, 0, 0], [0, 1.0, 0], [0, 0, 1.15]] },
  cinematic:   { label: 'Cinematic',     recomb: [[0.90, 0.05, 0.05], [0, 0.95, 0.05], [0.15, 0.05, 0.80]], saturation: 0.85, brightness: 0.95 },
  vintage:     { label: 'Vintage',       recomb: [[1.05, 0.05, 0], [0.05, 0.9, 0.05], [0, 0.05, 0.80]], saturation: 0.72, lift: 15 },
  fade:        { label: 'Fade',          saturation: 0.65, brightness: 1.05, contrast: 0.82, lift: 35 },
  matte:       { label: 'Matte',         saturation: 0.82, contrast: 0.88, lift: 20 },
  vivid:       { label: 'Vivid',         saturation: 1.45, contrast: 1.1 },
  noir:        { label: 'Noir (B&W)',    saturation: 0, contrast: 1.2, brightness: 0.95 },
  golden:      { label: 'Golden hour',   recomb: [[1.25, 0.05, 0], [0, 1.0, 0], [0, 0, 0.70]], saturation: 1.2, brightness: 1.05 },
  teal_orange: { label: 'Teal & orange', recomb: [[1.1, 0, 0], [0, 0.95, 0.05], [0.1, 0.1, 0.80]], saturation: 1.05 },
};

router.post('/colorgrade', async (req, res) => {
  try {
    const buf = dataUrlToBuffer(req.body?.imageDataUrl || '');
    if (!buf) return res.status(400).json({ error: 'No valid image provided' });

    const presetKey = Object.prototype.hasOwnProperty.call(COLORGRADE_PRESETS, req.body?.preset)
      ? req.body.preset
      : 'warm';
    const preset = COLORGRADE_PRESETS[presetKey];

    const meta = await sharp(buf).rotate().metadata();
    const fmt = outputFormatFor(meta);
    let pipeline = sharp(buf).rotate();

    if (preset.recomb) pipeline = pipeline.recomb(preset.recomb);

    const modOpts = {};
    if (preset.brightness && preset.brightness !== 1) modOpts.brightness = preset.brightness;
    if (preset.saturation !== undefined && preset.saturation !== 1) modOpts.saturation = Number(preset.saturation);
    if (Object.keys(modOpts).length) pipeline = pipeline.modulate(modOpts);

    const contrast = preset.contrast || 1;
    const lift = preset.lift || 0;
    if (contrast !== 1 || lift !== 0) {
      pipeline = pipeline.linear(contrast, Math.round(lift + 128 * (1 - contrast)));
    }

    const out = await pipeline.toFormat(fmt).toBuffer();
    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      preset: presetKey,
      presetLabel: preset.label,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
      width: m2?.width,
      height: m2?.height,
      format: fmt,
      bytes: out.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Color grading failed' });
  }
});

// Batch text — composite the same (templated) text label onto multiple images.
// Template variables: {filename}, {index}, {n}, {date}.
router.post('/batch-text', async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) return res.status(400).json({ error: 'No images provided' });
    const items = images.slice(0, 20);

    const textTemplate = String(req.body?.text || '{filename}').slice(0, 200);
    const color = parseHexColor(req.body?.color)?.hex || '#ffffff';
    const bgHex = req.body?.background ? (parseHexColor(req.body.background)?.hex || null) : null;
    const fontSize = clampInt(req.body?.fontSize, 8, 200, 36);
    const opacity = Math.max(0, Math.min(1, Number(req.body?.opacity) || 0.85));
    const gravity = GRAVITY_MAP[req.body?.position] || 'southeast';
    const today = new Date().toISOString().slice(0, 10);

    const results = [];
    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      const dataUrl = typeof item === 'string' ? item : (item.imageDataUrl || '');
      const rawName = typeof item === 'object' ? (item.name || `image-${idx + 1}`) : `image-${idx + 1}`;
      const buf = dataUrlToBuffer(dataUrl);
      if (!buf) { results.push({ name: rawName, error: 'Could not decode image' }); continue; }

      try {
        const meta = await sharp(buf).rotate().metadata();
        const fmt = outputFormatFor(meta);
        const baseName = rawName.replace(/\.[^/.]+$/, '');

        const label = textTemplate
          .replace(/\{filename\}/gi, baseName)
          .replace(/\{index\}/gi, String(idx + 1))
          .replace(/\{n\}/gi, String(items.length))
          .replace(/\{date\}/gi, today);

        const w = Math.ceil(label.length * fontSize * 0.62) + 28;
        const h = Math.ceil(fontSize * 1.6);

        let svgInner = `<text x="50%" y="50%" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${color}" fill-opacity="${opacity}" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>`;
        if (bgHex) {
          svgInner = `<rect width="${w}" height="${h}" fill="${bgHex}" fill-opacity="${Math.min(1, opacity * 1.2)}" rx="4"/>` + svgInner;
        }
        const svgBuf = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svgInner}</svg>`);

        const out = await sharp(buf).rotate().composite([{ input: svgBuf, gravity }]).toFormat(fmt).toBuffer();
        results.push({
          name: `${baseName}.${fmt}`,
          imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
          bytes: out.length,
          label,
        });
      } catch (e) {
        results.push({ name: rawName, error: e.message || 'Failed' });
      }
    }

    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Batch text failed' });
  }
});

// ── Print Ready ──────────────────────────────────────────────────────────────
// Converts any raster image into a print-ready file: sets the target DPI in
// metadata, optionally flattens alpha transparency, optionally adds bleed
// padding, and outputs as TIFF (LZW), PDF, or PNG.
router.post('/print-ready', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }

    const dpi = Math.min(1200, Math.max(72, Number(req.body?.dpi) || 300));
    const format = ['tiff', 'pdf', 'png'].includes(String(req.body?.format || '').toLowerCase())
      ? String(req.body.format).toLowerCase()
      : 'tiff';
    const background = String(req.body?.background || 'white').toLowerCase() === 'transparent'
      ? 'transparent'
      : 'white';
    const bleedMm = Math.min(25, Math.max(0, Number(req.body?.bleedMm) || 0));

    const meta = await sharp(buffer).metadata();
    const hasAlpha = (meta.channels === 4 || meta.hasAlpha);

    // Start the sharp pipeline
    let pipeline = sharp(buffer);

    // Flatten transparency → white background when requested (or when outputting
    // TIFF/PDF, which technically support alpha but most RIPs don't expect it)
    if (background === 'white' && hasAlpha) {
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    // Add bleed padding (white or transparent depending on background setting)
    if (bleedMm > 0) {
      // Convert mm → pixels at the target DPI
      const bleedPx = Math.round((bleedMm / 25.4) * dpi);
      const bleedColor = background === 'white'
        ? { r: 255, g: 255, b: 255, alpha: 1 }
        : { r: 255, g: 255, b: 255, alpha: 0 };
      pipeline = pipeline.extend({
        top: bleedPx, bottom: bleedPx, left: bleedPx, right: bleedPx,
        background: bleedColor,
      });
    }

    // Embed DPI in output metadata
    pipeline = pipeline.withMetadata({ density: dpi });

    let outputBuffer;
    let mimeType;
    let ext;

    if (format === 'tiff') {
      outputBuffer = await pipeline.tiff({ compression: 'lzw', xres: dpi / 25.4, yres: dpi / 25.4 }).toBuffer();
      mimeType = 'image/tiff';
      ext = 'tiff';
    } else if (format === 'png') {
      outputBuffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      mimeType = 'image/png';
      ext = 'png';
    } else {
      // PDF: embed image at the correct physical size using pdf-lib
      // First render to PNG (best lossless intermediate for PDF embedding)
      const pngBuf = await pipeline.png().toBuffer();
      const finalMeta = await sharp(pngBuf).metadata();
      const { PDFDocument } = require('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      const embedded = await pdfDoc.embedPng(pngBuf);
      // Physical dimensions in points (1 inch = 72 points)
      const widthPt = (finalMeta.width / dpi) * 72;
      const heightPt = (finalMeta.height / dpi) * 72;
      const page = pdfDoc.addPage([widthPt, heightPt]);
      page.drawImage(embedded, { x: 0, y: 0, width: widthPt, height: heightPt });
      outputBuffer = Buffer.from(await pdfDoc.save());
      mimeType = 'application/pdf';
      ext = 'pdf';
    }

    // Calculate physical print size for the UI
    const finalMeta = format === 'pdf'
      ? await sharp(buffer).metadata()
      : await sharp(outputBuffer).metadata();
    const pxW = finalMeta.width || meta.width || 0;
    const pxH = finalMeta.height || meta.height || 0;
    const printWidthIn = pxW / dpi;
    const printHeightIn = pxH / dpi;
    const printWidthMm = Math.round(printWidthIn * 25.4);
    const printHeightMm = Math.round(printHeightIn * 25.4);

    // Quality assessment
    const effectiveDpi = dpi;
    let qualityNote = '';
    if (pxW < dpi * 1 || pxH < dpi * 1) {
      qualityNote = 'warning: image is smaller than 1×1 inch at this DPI — output may appear pixelated when printed';
    } else if (pxW < dpi * 2 || pxH < dpi * 2) {
      qualityNote = 'note: image is suitable for small print sizes only';
    }

    const dataUrl = `data:${mimeType};base64,${outputBuffer.toString('base64')}`;
    res.json({
      ok: true,
      imageDataUrl: dataUrl,
      ext,
      format,
      dpi: effectiveDpi,
      bytes: outputBuffer.length,
      pixelWidth: pxW,
      pixelHeight: pxH,
      printWidthMm,
      printHeightMm,
      printWidthIn: Math.round(printWidthIn * 100) / 100,
      printHeightIn: Math.round(printHeightIn * 100) / 100,
      hasAlpha: hasAlpha && background === 'transparent',
      bleedMm,
      qualityNote,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Print-ready conversion failed' });
  }
});

module.exports = router;
