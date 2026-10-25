'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const archiver = require('archiver');
const ImageTracer = require('imagetracerjs');
const exifReader = require('exif-reader');
const { runtimeConfig } = require('../../config/runtime');
const { callModel } = require('../../services/callModel');
const { pool } = require('../../db');
const { fetchPublicFile } = require('../../utils/safeFetch');

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
const { getVaultModelsConfigForUser, getModelsForUser } = require('../../services/modelResolver');
const { logUsage } = require('../../utils/logUsage');

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

const escapeRegExp = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match (with an optional plural / -ed / -ing ending), so "gore" does not fire on "Singapore".
const wordRegex = (term) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}(s|es|ed|ing)?([^a-z0-9]|$)`, 'i');

// Related words an admin's short restriction should also catch.
const RESTRICTION_SYNONYMS = [
  [/nud/, ['nude', 'nudity', 'naked']],
  [/viol/, ['violence', 'violent']],
  [/gore/, ['gore', 'gory']],
];

// A restriction matches a prompt when its whole phrase appears, or (for a several-word restriction) every
// meaningful word in it appears, or one of its known synonyms appears. Single words from a multi-word
// restriction do NOT match on their own: "graphic violence" must not block "graphic design".
function restrictionSearchTerms(restriction) {
  const raw = String(restriction || '').trim().toLowerCase();
  const terms = new Set(raw ? [raw] : []);
  RESTRICTION_SYNONYMS.forEach(([test, words]) => { if (test.test(raw)) words.forEach((w) => terms.add(w)); });
  return Array.from(terms);
}

function findRestrictionMatches(prompt, restrictions = []) {
  const source = String(prompt || '').toLowerCase();
  return restrictions
    .map((restriction) => {
      const matchedTerms = restrictionSearchTerms(restriction).filter((term) => wordRegex(term).test(source));
      if (!matchedTerms.length) {
        const parts = String(restriction || '').toLowerCase().split(/[^a-z0-9]+/).filter((p) => p.length >= 4);
        if (parts.length > 1 && parts.every((p) => wordRegex(p).test(source))) matchedTerms.push(...parts);
      }
      return matchedTerms.length ? { restriction, matchedTerms } : null;
    })
    .filter(Boolean);
}

// Server-side enforcement of the admin's content restrictions. The browser asks /preflight first, but a
// caller can skip that, so every route that sends text to an image model calls this. Throws a 422 carrying
// the matches; the routes put them in the response.
function assertPromptAllowed(promptTexts, restrictions) {
  const list = Array.isArray(promptTexts) ? promptTexts : [promptTexts];
  const matches = list.flatMap((text) => findRestrictionMatches(text, restrictions));
  if (!matches.length) return;
  const unique = [...new Map(matches.map((m) => [m.restriction, m])).values()];
  throw Object.assign(new Error(`This request matches a content restriction set by your admin (${unique.map((m) => m.restriction).join(', ')}). Change the description and try again.`), {
    status: 422,
    code: 'CONTENT_RESTRICTED',
    matches: unique,
  });
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

// Turns a short description into a stronger prompt for the image model.
//  - Hosted (production): the workspace's own light-tier model from Settings, via callModel. One small call, logged as `graphics_refine`
//    so it shows on the Usage dashboard and counts toward the daily AI spend cap.
//  - Local development: the free local Ollama model, as before.
// Never throws and never blocks image generation: if there is no model, the call fails, or the answer is not a usable prompt,
// the person's own prompt is used unchanged. Resolves { prompt, model, refined }.
const REFINE_SYSTEM = 'You rewrite short descriptions into strong prompts for a text-to-image model. Reply with ONLY the final image prompt: no quotes, no labels, no explanation.';

// A model's reply is untrusted text that goes straight into an image prompt, so keep only something that looks like one.
function cleanRefinedPrompt(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  const unquote = (x) => x.replace(/^["'`\u201c\u2018]+|["'`\u201d\u2019]+$/g, '').trim();
  t = unquote(unquote(t).replace(/^(final\s+)?(image\s+)?prompt\s*:\s*/i, ''));
  if (!t || t.length > 1200) return null;
  if (/^(i\s+can(?:no|'|\u2019)t|i\s+am\s+unable|i'm\s+(sorry|unable)|sorry\b|as\s+an\s+ai\b|unable\s+to\b)/i.test(t)) return null;
  return t;
}

async function refinePromptForImage(rawPrompt, restrictions = [], { userId } = {}) {
  const source = String(rawPrompt || '').trim();
  if (!source) throw new Error('Prompt required');
  const unchanged = { prompt: source, model: null, refined: false };
  const restrictionLines = restrictions.length
    ? restrictions.map((restriction) => `- ${restriction}`).join('\n')
    : '- None configured';

  const instruction = `Rewrite this into a strong prompt for a text-to-image model.

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
${source.slice(0, 1000)}`;

  try {
    if (runtimeConfig.isLocal) {
      const data = await fetchJson(`${ollamaBaseUrl()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: localTextModel(), prompt: instruction, stream: false, options: { temperature: 0.4, num_predict: 220 } }),
      });
      const prompt = cleanRefinedPrompt(data.response);
      return prompt ? { prompt, model: localTextModel(), refined: true } : unchanged;
    }
    if (!userId) return unchanged;
    const { light, standard } = await getModelsForUser(userId);
    const modelId = light || standard;
    if (!modelId) return unchanged;
    const out = await callModel(modelId, instruction, { maxTokens: 300, system: REFINE_SYSTEM, returnUsage: true, timeoutMs: 20000 });
    logUsage({ userId, model: out.model || modelId, inputTokens: out.inputTokens, outputTokens: out.outputTokens, feature: 'graphics_refine' });
    const prompt = cleanRefinedPrompt(typeof out === 'string' ? out : out.text);
    return prompt ? { prompt, model: out.model || modelId, refined: true } : { ...unchanged, model: out.model || modelId };
  } catch (err) {
    console.warn('[graphics] prompt refinement failed:', err.message);
    return unchanged;
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
function upscaleCostForSize({ width, height, scale }) {
  const ratePerMp = Number(process.env.REPLICATE_UPSCALE_RATE_PER_MP) || 0.03;
  const minUsd = Number(process.env.REPLICATE_UPSCALE_MIN_USD) || 0.03;
  if (!width || !height) return { usd: null, megapixels: null, ratePerMp, estimate: true };
  const megapixels = Math.min(64, (width * scale * height * scale) / 1e6);
  const usd = Math.max(minUsd, megapixels * ratePerMp);
  return { usd: Number(usd.toFixed(4)), megapixels: Number(megapixels.toFixed(2)), ratePerMp, estimate: true };
}

function estimateUpscaleCost({ provider, inputBuffer, scale }) {
  if (provider === 'local-comfyui') return { usd: 0, megapixels: null, local: true };
  const size = inputBuffer ? getImageSize(inputBuffer) : null;
  return upscaleCostForSize({ width: size?.width, height: size?.height, scale });
}

// Hosted background removal is a flat per-image price; the local ONNX model is free.
function estimateBackgroundCost({ isLocal }) {
  if (isLocal) return { usd: 0, local: true };
  const usd = Number(process.env.REPLICATE_BG_COST_USD) || 0.02;
  return { usd: Number(usd.toFixed(4)), estimate: true };
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

// Size of an image AFTER its EXIF orientation is applied (sharp's metadata() reports the stored pixels,
// but .rotate() makes orientations 5-8 swap width and height). Use this for anything computed from a
// pipeline that calls .rotate().
function orientedSize(meta) {
  const w = meta?.width || 0;
  const h = meta?.height || 0;
  return meta?.orientation >= 5 ? { width: h, height: w } : { width: w, height: h };
}

// sharp refuses to composite an overlay bigger than the base ("Image to composite must have same
// dimensions or smaller"). Shrink an overlay (PNG or SVG buffer) to fit inside the base, never enlarge.
async function fitOverlay(overlay, baseWidth, baseHeight) {
  const m = await sharp(overlay).metadata();
  if (!m.width || !m.height || (m.width <= baseWidth && m.height <= baseHeight)) return overlay;
  return sharp(overlay).resize(baseWidth, baseHeight, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

// Animated pictures (GIF, animated WebP) are read as ONE frame by every tool except Convert and Compress, which keep the
// animation. Rather than quietly hand back a still, the editing tools stop and say so.
function assertStill(meta) {
  if (meta?.pages > 1) {
    throw Object.assign(new Error('This is an animated picture, and this tool would keep only its first frame, so it was not changed. Convert and Compress keep the animation; for anything else, save a single frame first.'), { status: 422, code: 'ANIMATED_NOT_SUPPORTED' });
  }
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
// Encoder settings for tool outputs. sharp's own defaults (JPEG and WebP at quality 80) visibly soften an
// edit of a good photo and stack up when results are fed into the next tool, so keep more of the picture.
function outputOptionsFor(fmt) {
  if (fmt === 'jpeg') return { quality: 92 };
  if (fmt === 'webp') return { quality: 92 };
  if (fmt === 'avif') return { quality: 70 };
  return {};
}

// Like dataUrlToBuffer, but only for data URLs that claim to be images (so a PDF or text blob gets a clean 400
// from the route instead of a decoder error).
function imageDataUrlToBuffer(value) {
  const text = String(value || '');
  return /^data:image\//i.test(text) ? dataUrlToBuffer(text) : null;
}

function clampQuality(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 90;
  return Math.min(100, Math.max(1, n));
}
function outputFormatFor(meta) {
  return ['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff'].includes(meta?.format) ? meta.format : 'png';
}
const GRAVITY_MAP = {
  center: 'centre', centre: 'centre',
  top: 'north', bottom: 'south', left: 'west', right: 'east',
  'top-left': 'northwest', 'top-right': 'northeast',
  'bottom-left': 'southwest', 'bottom-right': 'southeast',
};
function parseHexColor(value) {
  let hex = String(value || '').trim();
  const m = hex.match(/^#?([0-9a-f]{6})$/i) || hex.match(/^#?([0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), hex: `#${h.toLowerCase()}` };
}
// Common social-media / ad-platform export sizes, offered as a `preset` id in
// /resize (and listed for the client's dropdown) so members don't need to know
// exact pixel dimensions by heart.
const SOCIAL_PRESETS = [
  { id: 'instagram-post', name: 'Instagram Post', width: 1080, height: 1080, label: 'Instagram Post (1080x1080)' },
  { id: 'instagram-story', name: 'Instagram Story', width: 1080, height: 1920, label: 'Instagram Story (1080x1920)' },
  { id: 'instagram-portrait', name: 'Instagram Portrait', width: 1080, height: 1350, label: 'Instagram Portrait (1080x1350)' },
  { id: 'facebook-post', name: 'Facebook Post', width: 1200, height: 630, label: 'Facebook Post (1200x630)' },
  { id: 'facebook-cover', name: 'Facebook Cover', width: 820, height: 312, label: 'Facebook Cover (820x312)' },
  { id: 'linkedin-post', name: 'LinkedIn Post', width: 1200, height: 1254, label: 'LinkedIn Post (1200x1254)' },
  { id: 'linkedin-banner', name: 'LinkedIn Banner', width: 1584, height: 396, label: 'LinkedIn Banner (1584x396)' },
  { id: 'twitter-post', name: 'Twitter/X Post', width: 1600, height: 900, label: 'Twitter/X Post (1600x900)' },
  { id: 'youtube-thumbnail', name: 'YouTube Thumbnail', width: 1280, height: 720, label: 'YouTube Thumbnail (1280x720)' },
  { id: 'pinterest-pin', name: 'Pinterest Pin', width: 1000, height: 1500, label: 'Pinterest Pin (1000x1500)' },
];
// Import an image by URL (server-side fetch avoids browser CORS). Returns a data URL.
// The fetch itself is in utils/safeFetch.js: public addresses only (checked on every redirect hop and pinned
// against DNS rebinding), ports 80/443, streamed with a 25MB cap.
router.post('/fetch-url', async (req, res) => {
  try {
    const raw = String(req.body?.url || '').trim();
    const { buffer, contentType, finalUrl } = await fetchPublicFile(raw, { maxBytes: 25 * 1024 * 1024, accept: 'image/*' });
    const ct = contentType.toLowerCase().split(';')[0].trim();
    if (!ct.startsWith('image/')) return res.status(400).json({ error: `That URL is not an image (${ct || 'unknown type'})` });
    if (!buffer.length) return res.status(400).json({ error: 'The URL returned an empty image' });
    // A page can claim image/png and send HTML; make sure the bytes really decode as an image.
    try { await sharp(buffer).metadata(); } catch { return res.status(400).json({ error: 'That URL did not return a readable image' }); }
    const pathname = new URL(finalUrl).pathname;
    let name = 'image';
    try { name = decodeURIComponent((pathname.split('/').pop() || '').trim()) || 'image'; } catch { name = (pathname.split('/').pop() || '').trim() || 'image'; }
    res.json({ ok: true, name, bytes: buffer.length, imageDataUrl: `data:${ct};base64,${buffer.toString('base64')}` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Fetching the image failed' });
  }
});

module.exports = {
  router,
  randomUUID,
  sharp,
  archiver,
  ImageTracer,
  exifReader,
  runtimeConfig,
  callModel,
  pool,
  getVaultModelsConfigForUser,
  safeJsonParse,
  pickOneOf,
  sanitizeIconName,
  getSvgPurify,
  regexStripSvg,
  sanitizeSvgMarkup,
  DEFAULT_COMFY_URL,
  DEFAULT_MODEL,
  DEFAULT_FAL_MODEL,
  CONTENT_RESTRICTIONS_KEY,
  GRAPHICS_MODEL_KEY,
  UPSCALE_MODEL_KEY,
  DEFAULT_LOCAL_UPSCALE_MODEL,
  DEFAULT_REPLICATE_UPSCALE_MODEL,
  HOSTED_UPSCALE_MODELS,
  DEFAULT_REPLICATE_BG_MODEL,
  getImgly,
  CONVERT_FORMATS,
  isHeicBuffer,
  packIco,
  comfyBaseUrl,
  normalizeGraphicsProvider,
  resolveGraphicsModel,
  resolveGraphicsProvider,
  isTurboModel,
  samplerSettings,
  ollamaBaseUrl,
  localTextModel,
  clampDimension,
  normalizeContentRestrictions,
  loadContentRestrictions,
  buildNegativePrompt,
  restrictionSearchTerms,
  findRestrictionMatches,
  assertPromptAllowed,
  buildWorkflow,
  buildAugmentWorkflow,
  fetchJson,
  resolveFalEndpoint,
  falImageSize,
  imageUrlToDataUrl,
  generateWithFal,
  augmentWithFal,
  inpaintWithFal,
  refinePromptForImage,
  waitForImage,
  uploadImageToComfy,
  loadImageDataUrl,
  listAvailableComfyModels,
  clampScale,
  clampCreativity,
  listAvailableUpscaleModels,
  resolveUpscaleModel,
  buildUpscaleWorkflow,
  buildReplicateUpscaleInput,
  waitForReplicate,
  dataUrlToBuffer,
  getImageSize,
  estimateUpscaleCost,
  upscaleCostForSize,
  estimateBackgroundCost,
  estimateGenerateCost,
  logImageUsage,
  envReplicateUpscaleModel,
  resolveHostedUpscaleModel,
  upscaleWithReplicate,
  clampInt,
  orientedSize,
  fitOverlay,
  assertStill,
  outputOptionsFor,
  imageDataUrlToBuffer,
  clampQuality,
  outputFormatFor,
  GRAVITY_MAP,
  parseHexColor,
  SOCIAL_PRESETS,
};
