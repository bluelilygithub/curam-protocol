'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { runtimeConfig } = require('../config/runtime');
const { pool } = require('../db');
const { getVaultModelsConfigForUser } = require('../services/modelResolver');

const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';
const DEFAULT_MODEL = 'DreamShaper_8_pruned.safetensors';
const DEFAULT_FAL_MODEL = 'fal-ai/flux/dev';
const CONTENT_RESTRICTIONS_KEY = 'graphics_content_restrictions';
const GRAPHICS_MODEL_KEY = 'graphics_model';

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
      return res.json({
        ok: true,
        prompt,
        refinedPrompt,
        seed: falResult.seed,
        width,
        height,
        model: modelName,
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

module.exports = router;
