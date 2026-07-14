'use strict';

const { pool } = require('../db');
const { runtimeConfig } = require('../config/runtime');
const { getVaultModelsConfigForUser } = require('./modelResolver');

const DEFAULT_FAL_MODEL = 'fal-ai/flux/dev';
const GRAPHICS_MODEL_KEY = 'graphics_model';

function normalizeGraphicsProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'seedance') return 'fal';
  return normalized;
}

async function resolveGraphicsModel(userId) {
  if (runtimeConfig.isLocal) {
    return runtimeConfig.localImageModel || 'DreamShaper_8_pruned.safetensors';
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
  return adminModel || runtimeConfig.localImageModel || DEFAULT_FAL_MODEL;
}

async function resolveGraphicsProvider(userId, selectedModel) {
  if (runtimeConfig.isLocal) return 'local-comfyui';
  if (runtimeConfig.imageProvider) return normalizeGraphicsProvider(runtimeConfig.imageProvider);
  if (!selectedModel) return runtimeConfig.isProduction ? 'fal' : 'local-comfyui';

  const config = await getVaultModelsConfigForUser(userId);
  const configuredModel = config.models.find((model) => model.id === selectedModel);
  return normalizeGraphicsProvider(configuredModel?.provider) || (runtimeConfig.isProduction ? 'fal' : 'local-comfyui');
}

function resolveFalEndpoint(modelName) {
  const raw = String(modelName || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, '-');
  let endpoint = raw || DEFAULT_FAL_MODEL;
  if (['flux-dev', 'flux.1-dev', 'flux-dev-1', 'fal-ai/flux-dev'].includes(key)) {
    endpoint = DEFAULT_FAL_MODEL;
  }
  if (!endpoint.includes('/') && endpoint.toLowerCase().includes('flux') && endpoint.toLowerCase().includes('dev')) {
    endpoint = DEFAULT_FAL_MODEL;
  }
  return endpoint.replace(/^https:\/\/fal\.run\//, '').replace(/^\/+/, '');
}

function falImageSize(width, height) {
  if (width === height) return width > 512 ? 'square_hd' : 'square';
  return width > height ? 'landscape_4_3' : 'portrait_4_3';
}

function clampDimension(value) {
  const n = Number(value) || 512;
  const rounded = Math.round(n / 64) * 64;
  return Math.max(256, Math.min(1024, rounded));
}

async function imageUrlToDataUrl(url, contentType = 'image/jpeg') {
  const imageUrl = String(url || '');
  if (imageUrl.startsWith('data:image/')) return imageUrl;
  if (!imageUrl) throw new Error('Image provider returned no URL');
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch generated image (${res.status})`);
  const mime = res.headers.get('content-type') || contentType || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function estimateGenerateCost({ provider }) {
  if (provider === 'local-comfyui') return { usd: 0, local: true };
  const usd = Number(process.env.FAL_IMAGE_COST_USD) || 0.025;
  return { usd: Number(usd.toFixed(4)), estimate: true };
}

function logImageUsage({ userId, model, feature, costUsd }) {
  if (!userId || !costUsd || costUsd <= 0) return;
  pool.query(
    `INSERT INTO usage_logs (user_id, model_id, input_tokens, output_tokens, estimated_cost_usd, feature)
     VALUES ($1, $2, 0, 0, $3, $4)`,
    [userId, model || feature, costUsd, feature]
  ).catch((err) => console.error('[graphicsImage] usage log error:', err.message));
}

async function generateWithFal({ prompt, width, height, seed, modelName }) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY is not configured');

  const endpoint = resolveFalEndpoint(modelName);
  const res = await fetch(`https://fal.run/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
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

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || `Image generation failed (${res.status})`);
  }

  const image = Array.isArray(data.images) ? data.images[0] : null;
  if (!image?.url) throw new Error('Image provider returned no image');

  const imageDataUrl = await imageUrlToDataUrl(image.url, image.content_type);
  return {
    seed: Number.isFinite(Number(data.seed)) ? Number(data.seed) : seed,
    model: modelName,
    endpoint,
    imageDataUrl,
  };
}

async function getImageGenStatus(userId) {
  const model = await resolveGraphicsModel(userId);
  const provider = await resolveGraphicsProvider(userId, model);
  const configured = provider === 'fal'
    ? Boolean(process.env.FAL_API_KEY?.trim())
    : provider === 'local-comfyui';

  return {
    available: Boolean(model && configured),
    provider,
    model,
    configured,
    error: !model
      ? 'No graphics model selected in Settings → AI & Chat'
      : configured
        ? null
        : provider === 'fal'
          ? 'FAL_API_KEY is not configured'
          : `Image provider ${provider} is not configured`,
  };
}

/**
 * Generate an image using the same model routing as Graphics (admin graphics_model).
 */
async function generateImage(userId, {
  prompt,
  width = 768,
  height = 768,
  feature = 'graphics_generate',
} = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Prompt required');

  const modelName = await resolveGraphicsModel(userId);
  const provider = await resolveGraphicsProvider(userId, modelName);
  const w = clampDimension(width);
  const h = clampDimension(height);
  const seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

  if (provider !== 'fal') {
    return {
      ok: false,
      error: provider === 'local-comfyui'
        ? 'Use the Graphics app for local ComfyUI generation'
        : `Image provider ${provider} is not supported here — configure a FAL graphics model in Settings`,
      provider,
      model: modelName,
    };
  }

  const result = await generateWithFal({ prompt: text, width: w, height: h, seed, modelName });
  const cost = estimateGenerateCost({ provider: 'fal' });
  logImageUsage({ userId, model: `fal:${modelName}`, feature, costUsd: cost.usd });

  return {
    ok: true,
    imageDataUrl: result.imageDataUrl,
    seed: result.seed,
    width: w,
    height: h,
    model: modelName,
    provider: 'fal',
    cost,
  };
}

module.exports = {
  GRAPHICS_MODEL_KEY,
  resolveGraphicsModel,
  resolveGraphicsProvider,
  getImageGenStatus,
  generateImage,
  generateWithFal,
  imageUrlToDataUrl,
  estimateGenerateCost,
  logImageUsage,
};
