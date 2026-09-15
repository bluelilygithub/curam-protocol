'use strict';

// Retouch tools: Background, Extract Element, Recolor, Inpaint / Remove.
// (Eraser and Redact are browser-only and have no server routes.)

const express = require('express');
const router = express.Router();
const sharp = require('sharp');
const {
  runtimeConfig,
  dataUrlToBuffer,
  parseHexColor,
  logImageUsage,
  loadContentRestrictions,
  resolveGraphicsModel,
  resolveGraphicsProvider,
  inpaintWithFal,
  estimateGenerateCost,
  imageUrlToDataUrl,
  waitForReplicate,
  getImgly,
  DEFAULT_REPLICATE_BG_MODEL,
} = require('./shared');

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
function dataUrlMime(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,/i);
  return m ? m[1] : 'image/png';
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

module.exports = router;
