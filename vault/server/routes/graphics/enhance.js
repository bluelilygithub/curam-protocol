'use strict';

// Enhance tools: Effects, Adjust, Color Grading, Pipeline.

const express = require('express');
const router = express.Router();
const sharp = require('sharp');
const {
  dataUrlToBuffer,
  imageDataUrlToBuffer,
  outputFormatFor,
  outputOptionsFor,
  assertStill,
  clampInt,
  parseHexColor,
  orientedSize,
  loadBrandLogo,
  runtimeConfig,
  pool,
  upscaleWithReplicate,
  logImageUsage,
  estimateBackgroundCost,
  upscaleCostForSize,
} = require('./shared');
const { runWatermark } = require('./compose');
const { guardPaidJob } = require('../../middleware/graphicsLimits');
const paid = require('../../services/graphicsPaidSteps');

// Deterministic multi-step pipeline: apply a whitelisted sequence of sharp ops.
const PIPELINE_OPS = ['grayscale', 'sepia', 'invert', 'blur', 'sharpen', 'brightness', 'contrast', 'saturation', 'gamma', 'rotate', 'flip', 'flop', 'resize', 'border', 'temperature', 'crop', 'watermark', 'logo', ...paid.PAID_OPS];
const PIPELINE_MAX_STEPS = 12;
const CROP_STRATEGIES = { attention: sharp.strategy.attention, entropy: sharp.strategy.entropy, centre: 'centre', center: 'centre' };
const PIPE_OUT_FORMATS = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', avif: 'avif' };

const stepError = (message, status = 400) => Object.assign(new Error(message), { status });
const pngDataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

// "16:9", "1:1", "4:5" -> a width/height ratio, or null.
function parseAspect(value) {
  const m = String(value || '').trim().match(/^(\d{1,3}(?:\.\d+)?)\s*:\s*(\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const r = Number(m[1]) / Number(m[2]);
  return r >= 0.1 && r <= 10 ? r : null;
}

// The AI services a recipe's paid steps call. Looked up when needed (and replaceable in tests through ctx.deps).
function paidDeps(ctx) {
  const given = ctx.deps || {};
  const needsRetouch = !given.removeBgLocal || !given.removeBgWithReplicate;
  const retouch = needsRetouch ? require('./retouch') : {};
  return {
    isLocal: runtimeConfig.isLocal,
    removeBgLocal: retouch.removeBgLocal,
    removeBgWithReplicate: retouch.removeBgWithReplicate,
    upscaleWithReplicate,
    logImageUsage,
    ...given,
  };
}

// The prices a recipe is quoted with: the same estimators the single Background and Upscale tools use.
function recipePrices() {
  return paid.makePrices({ isLocal: runtimeConfig.isLocal, backgroundCost: estimateBackgroundCost, upscaleCost: upscaleCostForSize });
}

// ctx.brandLogoDataUrl is the person's Brand Kit logo (the 'logo' step uses it; a recipe never stores a picture).
async function applyPipelineStep(buffer, step, ctx = {}) {
  const op = String(step?.op || '');
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  if (op === 'crop') {
    const ratio = parseAspect(step.aspect);
    if (!ratio) throw stepError('Crop needs a shape like 1:1, 4:5 or 16:9');
    const upright = await sharp(buffer).rotate().toBuffer();
    const { width: W, height: H } = await sharp(upright).metadata();
    const w = ratio > W / H ? W : Math.max(1, Math.round(H * ratio));
    const h = ratio > W / H ? Math.max(1, Math.round(W / ratio)) : H;
    const position = CROP_STRATEGIES[String(step.strategy || 'attention')] || CROP_STRATEGIES.attention;
    return sharp(upright).resize({ width: w, height: h, fit: 'cover', position }).png({ compressionLevel: 1 }).toBuffer();
  }
  if (op === 'watermark' || op === 'logo') {
    if (op === 'watermark' && !String(step.text || '').trim()) throw stepError('The text step needs some words');
    if (op === 'logo' && !ctx.brandLogoDataUrl) throw stepError('This recipe adds your Brand Kit logo, but no logo is saved. Add one in Brand Kit first.');
    const upright = await sharp(buffer).rotate().png({ compressionLevel: 1 }).toBuffer();
    const common = { imageDataUrl: pngDataUrl(upright), opacity: clamp(num(step.opacity, op === 'logo' ? 0.9 : 0.5), 0, 1), position: step.position };
    const out = op === 'logo'
      ? await runWatermark({ ...common, type: 'image', watermarkDataUrl: ctx.brandLogoDataUrl, scale: clamp(num(step.scale, 20), 1, 100) })
      : await runWatermark({ ...common, type: 'text', text: step.text, color: step.color, fontSize: step.fontSize });
    return dataUrlToBuffer(out.imageDataUrl);
  }

  if (op === 'removebg') {
    const d = paidDeps(ctx);
    const upright = await sharp(buffer).rotate().png({ compressionLevel: 1 }).toBuffer();
    let cut;
    if (d.isLocal) {
      cut = await d.removeBgLocal(upright, 'image/png'); // on this machine: free
    } else {
      const result = await d.removeBgWithReplicate(pngDataUrl(upright));
      cut = dataUrlToBuffer(result.imageDataUrl);
      d.logImageUsage({ userId: ctx.userId, model: `replicate:${result.model}`, feature: 'graphics_background', costUsd: estimateBackgroundCost({ isLocal: false }).usd });
    }
    return sharp(cut).png({ compressionLevel: 1 }).toBuffer();
  }
  if (op === 'upscale') {
    const d = paidDeps(ctx);
    if (d.isLocal) throw stepError(paid.UPSCALE_LIVE_ONLY);
    const upright = await sharp(buffer).rotate().png({ compressionLevel: 1 }).toBuffer();
    const meta = await sharp(upright).metadata();
    const scale = paid.upscaleScaleOf(step);
    const tooBig = paid.upscaleTooBig([{ op: 'upscale', scale }], meta);
    if (tooBig) throw stepError(tooBig);
    const result = await d.upscaleWithReplicate({ imageDataUrl: pngDataUrl(upright), scale, creativity: Number.isFinite(Number(step.creativity)) ? Number(step.creativity) : -8 });
    d.logImageUsage({ userId: ctx.userId, model: `replicate:${result.model}`, feature: 'graphics_upscale', costUsd: upscaleCostForSize({ width: meta.width, height: meta.height, scale }).usd });
    return sharp(dataUrlToBuffer(result.imageDataUrl)).png({ compressionLevel: 1 }).toBuffer();
  }

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
  // Lossless between steps: re-saving a JPEG after each of up to 12 steps would pile up compression damage.
  // The caller encodes once, in the picture's own format, at the end.
  return pipe.png({ compressionLevel: 1 }).toBuffer();
}

// The whole pipeline as one function, so the single-image route, Batch ("Run a recipe") and saved recipes all use exactly this.
// `format` / `quality` are optional: the picture's own format is kept unless one is asked for (png, jpg, webp, avif).
async function runPipeline({ imageDataUrl, steps, format, quality, brandLogoDataUrl, userId, deps }) {
  let buffer = imageDataUrlToBuffer(String(imageDataUrl || ''));
  if (!buffer) throw stepError('A valid image is required');
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) throw stepError('Add at least one step');
  const valid = list.filter((s) => PIPELINE_OPS.includes(String(s?.op)));
  if (!valid.length) throw stepError('No recognised steps');
  if (valid.length > PIPELINE_MAX_STEPS) throw stepError(`Too many steps (max ${PIPELINE_MAX_STEPS})`);

  const meta = await sharp(buffer).metadata();
  assertStill(meta);
  const tooBig = paid.upscaleTooBig(valid, orientedSize(meta)); // refuse before spending anything
  if (tooBig) throw stepError(tooBig);
  // Upscale uses the hosted AI service: say so before the first step runs, not when it is reached.
  const isLocal = deps && 'isLocal' in deps ? deps.isLocal : runtimeConfig.isLocal;
  if (isLocal && valid.some((s) => s.op === 'upscale')) throw stepError(paid.UPSCALE_LIVE_ONLY);
  let fmt = outputFormatFor(meta);
  const wanted = PIPE_OUT_FORMATS[String(format || '').toLowerCase()];
  if (wanted) fmt = wanted;
  for (const step of valid) {
    // eslint-disable-next-line no-await-in-loop
    buffer = await applyPipelineStep(buffer, step, { brandLogoDataUrl, userId, deps });
  }
  const opts = outputOptionsFor(fmt);
  if (wanted && ['jpeg', 'webp', 'avif'].includes(fmt) && quality != null) opts.quality = clampInt(quality, 1, 100, opts.quality);
  let enc = sharp(buffer);
  if (fmt === 'jpeg') enc = enc.flatten({ background: '#ffffff' }); // a see-through picture becomes white, not black
  const out = await enc.toFormat(fmt, opts).toBuffer();
  const m2 = await sharp(out).metadata().catch(() => null);
  return {
    ok: true,
    steps: valid.length,
    width: m2?.width || null,
    height: m2?.height || null,
    format: fmt,
    ext: fmt === 'jpeg' ? 'jpg' : fmt,
    bytes: out.length,
    imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
  };
}

router.post('/pipeline', async (req, res) => {
  try {
    const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
    const brandLogoDataUrl = steps.some((s) => s?.op === 'logo') ? await loadBrandLogo(req.user.id) : null;
    // Steps that call a paid AI service: take a "jobs at once" slot and check the daily limit for what this run will cost, before it starts.
    if (paid.paidSteps(steps).length) {
      const buf = imageDataUrlToBuffer(String(req.body?.imageDataUrl || ''));
      const meta = buf ? await sharp(buf).metadata().catch(() => null) : null;
      const price = paid.priceJob(steps, [orientedSize(meta)], recipePrices());
      if (!(await guardPaidJob(pool, req, res, { totalUsd: price.usd }))) return;
    }
    res.json(await runPipeline({ imageDataUrl: req.body?.imageDataUrl, steps, format: req.body?.format, quality: req.body?.quality, brandLogoDataUrl, userId: req.user.id }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Pipeline failed' });
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
    assertStill(meta);
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

    const out = await pipeline.toFormat(fmt, outputOptionsFor(fmt)).toBuffer();
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
    res.status(err.status || 500).json({ error: err.message || 'Effect failed' });
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
    assertStill(meta);
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

    const out = await pipeline.toFormat(fmt, outputOptionsFor(fmt)).toBuffer();
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
    res.status(err.status || 500).json({ error: err.message || 'Adjust failed' });
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
    const buf = imageDataUrlToBuffer(req.body?.imageDataUrl);
    if (!buf) return res.status(400).json({ error: 'No valid image provided' });

    const presetKey = Object.prototype.hasOwnProperty.call(COLORGRADE_PRESETS, req.body?.preset)
      ? req.body.preset
      : 'warm';
    const preset = COLORGRADE_PRESETS[presetKey];

    const meta = await sharp(buf).rotate().metadata();
    assertStill(meta);
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

    const out = await pipeline.toFormat(fmt, outputOptionsFor(fmt)).toBuffer();
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
    res.status(err.status || 500).json({ error: err.message || 'Color grading failed' });
  }
});

router.runPipeline = runPipeline;
router.recipePrices = recipePrices;
router.PIPELINE_OPS = PIPELINE_OPS;
router.PIPELINE_MAX_STEPS = PIPELINE_MAX_STEPS;

module.exports = router;
