'use strict';

// Create tools: Generate, Animate (GIF). Also carries the model/status/
// refine/preflight support endpoints and the gallery CRUD used by Generate.

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const {
  runtimeConfig,
  pool,
  getVaultModelsConfigForUser,
  resolveGraphicsModel,
  resolveGraphicsProvider,
  listAvailableComfyModels,
  normalizeGraphicsProvider,
  comfyBaseUrl,
  fetchJson,
  loadContentRestrictions,
  refinePromptForImage,
  localTextModel,
  findRestrictionMatches,
  buildNegativePrompt,
  clampDimension,
  buildWorkflow,
  generateWithFal,
  estimateGenerateCost,
  logImageUsage,
  waitForImage,
  loadImageDataUrl,
  buildAugmentWorkflow,
  augmentWithFal,
  uploadImageToComfy,
  dataUrlToBuffer,
  clampInt,
} = require('./shared');

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

module.exports = router;
