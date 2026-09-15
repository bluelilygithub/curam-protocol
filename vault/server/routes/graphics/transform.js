'use strict';

// Transform tools: Crop / Resize, Canvas Extend, Perspective Correct, Smart Crop.
// `runResize` is defined once here and reused by ../optimise (/batch resize op,
// /export-social) so there is exactly one resize/crop implementation.

const express = require('express');
const router = express.Router();
const sharp = require('sharp');
const {
  dataUrlToBuffer,
  outputFormatFor,
  clampInt,
  GRAVITY_MAP,
  parseHexColor,
  SOCIAL_PRESETS,
} = require('./shared');

function parseAspect(value) {
  const m = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  return { w, h };
}

router.get('/social-presets', (req, res) => {
  res.json({ presets: SOCIAL_PRESETS });
});

// Core resize/crop logic, extracted so /resize (single image) and /batch (op:
// 'resize') share exactly one implementation. Throws Error with an optional
// `.status` (400 for validation) on failure; the route wrapper below maps that
// to the HTTP response, batch catches per-item instead.
async function runResize(params) {
  const imageDataUrl = String(params?.imageDataUrl || '');
  const buffer = dataUrlToBuffer(imageDataUrl);
  if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
    throw Object.assign(new Error('A valid image is required'), { status: 400 });
  }
  const meta = await sharp(buffer).metadata();
  const fmt = outputFormatFor(meta);
  const presetId = String(params?.preset || '').trim();
  const preset = presetId ? SOCIAL_PRESETS.find((p) => p.id === presetId) : null;
  const op = preset ? 'resize' : (params?.op === 'crop' ? 'crop' : 'resize');
  let pipeline = sharp(buffer).rotate();

  if (preset) {
    // Same 'cover' smart-crop logic as the aspect-ratio crop branch below,
    // applied directly to the preset's exact target dimensions. `strategy`
    // lets the caller override the focus point per preset — different
    // platform aspect ratios often need different framing of the same source.
    const strat = String(params?.strategy || 'smart');
    let position;
    if (strat === 'smart') position = sharp.strategy.attention;
    else if (strat === 'entropy') position = sharp.strategy.entropy;
    else position = GRAVITY_MAP[strat] || sharp.strategy.attention;
    pipeline = pipeline.resize(preset.width, preset.height, { fit: 'cover', position });
  } else if (op === 'resize') {
    const width = clampInt(params?.width, 1, 12000, undefined);
    const height = clampInt(params?.height, 1, 12000, undefined);
    if (!width && !height) throw Object.assign(new Error('Provide a width and/or height'), { status: 400 });
    const fit = ['cover', 'contain', 'fill', 'inside', 'outside'].includes(params?.fit) ? params.fit : 'inside';
    pipeline = pipeline.resize({ width, height, fit, withoutEnlargement: false });
  } else if (params?.rect && typeof params.rect === 'object') {
    // Manual crop to an exact pixel rectangle (from the interactive cropper).
    // Bake EXIF orientation first so the rect lines up with the displayed image.
    const oriented = await sharp(buffer).rotate().toBuffer();
    const om = await sharp(oriented).metadata();
    const W = om.width;
    const H = om.height;
    const left = clampInt(params.rect.x, 0, Math.max(0, W - 1), 0);
    const top = clampInt(params.rect.y, 0, Math.max(0, H - 1), 0);
    const width = clampInt(params.rect.w, 1, W - left, W - left);
    const height = clampInt(params.rect.h, 1, H - top, H - top);
    pipeline = sharp(oriented).extract({ left, top, width, height });
  } else {
    const ar = parseAspect(params?.aspect);
    if (!ar) throw Object.assign(new Error('A valid aspect ratio like 1:1 or 16:9 is required to crop'), { status: 400 });
    const W = meta.width;
    const H = meta.height;
    const arVal = ar.w / ar.h;
    let tw;
    let th;
    if (W / H > arVal) { th = H; tw = Math.round(H * arVal); } else { tw = W; th = Math.round(W / arVal); }
    const strat = String(params?.strategy || 'smart');
    let position;
    if (strat === 'smart') position = sharp.strategy.attention;
    else if (strat === 'entropy') position = sharp.strategy.entropy;
    else position = GRAVITY_MAP[strat] || 'centre';
    pipeline = pipeline.resize(tw, th, { fit: 'cover', position });
  }

  const out = await pipeline.toFormat(fmt).toBuffer();
  const m2 = await sharp(out).metadata().catch(() => null);
  return {
    ok: true,
    op,
    preset: preset ? preset.id : undefined,
    width: m2?.width || null,
    height: m2?.height || null,
    format: fmt,
    bytes: out.length,
    imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
  };
}

router.post('/resize', async (req, res) => {
  try {
    const result = await runResize(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Resize failed' });
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

router.runResize = runResize;

module.exports = router;
