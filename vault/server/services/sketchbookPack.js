'use strict';

// Sketchbook social media pack: one sketch made into every social size Graphics' Export for Social offers (the same SOCIAL_PRESETS list, so
// the two tools never disagree on a size). Each size is made one of three ways:
//   - crop: the sketch cut to the size's shape (sharp's attention crop, or a fixed side), then scaled to the exact pixels;
//   - fit:  the whole sketch kept, with white margins (sketches are drawn on white paper, so the margins blend in);
//   - redrawn: a paid AI redraw of the sketch for that shape (routes/sketchbook.js), stored on the sketch in "packRedraws".
// 'auto' crops when the crop keeps at least AUTO_CROP_KEEP of the picture, else fits, and uses a redraw made from the current picture first.
// Pure helpers plus sharp; no database and no AI here. Tested by sketchbookPack.test.js. See docs/sketchbook.md.

const crypto = require('crypto');
const sharp = require('sharp');
const { SOCIAL_PRESETS, dataUrlToBuffer } = require('../routes/graphics/shared');

const AUTO_CROP_KEEP = 0.8; // a crop that keeps 80% or more of the sketch looks like the sketch; below that a cartoon's point is often cut off
const SAME_SHAPE_KEEP = 0.97; // shapes this close need no redraw (a crop loses almost nothing)
const REDRAW_MAX_SIDE = 1600; // a stored redraw, longest side; social sizes go up to 1600px wide
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const MODES = {
  auto: 'Auto',
  fit: 'Whole picture (white margins)',
  'crop-smart': 'Crop: smart',
  'crop-centre': 'Crop: centre',
  'crop-top': 'Crop: top',
  'crop-bottom': 'Crop: bottom',
  'crop-left': 'Crop: left',
  'crop-right': 'Crop: right',
  redrawn: 'Redrawn for this shape',
};
const MODE_IDS = Object.keys(MODES);
const CROP_POSITION = { 'crop-centre': 'centre', 'crop-top': 'top', 'crop-bottom': 'bottom', 'crop-left': 'left', 'crop-right': 'right' };

const PACK_SIZES = SOCIAL_PRESETS.map((p) => ({ id: p.id, name: p.name, label: p.label, width: p.width, height: p.height }));
const sizeById = (id) => PACK_SIZES.find((p) => p.id === id) || null;

/** How much of a srcW x srcH picture a crop to the w x h shape keeps (1 = all of it). */
function keptShare(srcW, srcH, w, h) {
  if (!(srcW > 0 && srcH > 0 && w > 0 && h > 0)) return 1;
  const a = (srcW / srcH) / (w / h);
  return a > 1 ? 1 / a : a;
}

/** A short fingerprint of a picture, so a redraw can tell whether it was made from the picture the sketch has now. */
const imageKey = (image) => crypto.createHash('sha1').update(String(image || '')).digest('hex').slice(0, 16);

function checkMode(v) {
  return MODE_IDS.includes(v) ? v : 'auto';
}

/** The stored redraws, as { [sizeId]: { image, at, from } }; anything unreadable is dropped. */
function parseRedraws(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v || '{}'); } catch { v = {}; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [k, r] of Object.entries(v)) if (sizeById(k) && r && typeof r.image === 'string') out[k] = { image: r.image, at: r.at || null, from: r.from || null };
  return out;
}

/**
 * Which way a size is actually made: the mode asked for, with 'auto' (and 'redrawn' when there is no redraw) worked out.
 * Returns 'fit', a crop-* mode, or 'redrawn'.
 */
function resolveMode({ mode, kept, redraw, currentKey }) {
  const m = checkMode(mode);
  if (m === 'redrawn') return redraw ? 'redrawn' : (kept >= AUTO_CROP_KEEP ? 'crop-smart' : 'fit');
  if (m !== 'auto') return m;
  if (redraw && redraw.from === currentKey) return 'redrawn';
  return kept >= AUTO_CROP_KEEP ? 'crop-smart' : 'fit';
}

async function render(buf, size, used) {
  let p = sharp(buf).rotate().flatten({ background: WHITE });
  if (used === 'fit') p = p.resize(size.width, size.height, { fit: 'contain', background: WHITE });
  else if (used === 'redrawn' || used === 'crop-smart') p = p.resize(size.width, size.height, { fit: 'cover', position: sharp.strategy.attention });
  else p = p.resize(size.width, size.height, { fit: 'cover', position: CROP_POSITION[used] || 'centre' });
  return p.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

const slug = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sketch';

/**
 * One size of the pack. `sketch` is { title, image, width, height }; `redraws` from parseRedraws.
 * Returns the picture as a JPEG Buffer plus what the page shows about it.
 */
async function makeSize({ sketch, sizeId, mode, redraws }) {
  const size = sizeById(sizeId);
  if (!size) throw Object.assign(new Error('That size is not in the pack.'), { status: 400 });
  const src = dataUrlToBuffer(sketch.image);
  if (!src) throw new Error('The sketch picture could not be read.');
  let { width: sw, height: sh } = sketch;
  if (!(sw > 0 && sh > 0)) { const m = await sharp(src).metadata(); sw = m.width; sh = m.height; }
  const kept = keptShare(sw, sh, size.width, size.height);
  const currentKey = imageKey(sketch.image);
  const redraw = redraws[size.id] || null;
  const used = resolveMode({ mode, kept, redraw, currentKey });
  const buf = await render(used === 'redrawn' ? dataUrlToBuffer(redraw.image) : src, size, used);
  return {
    buf,
    item: {
      id: size.id, name: size.name, label: size.label, width: size.width, height: size.height,
      mode: checkMode(mode), used, keptPercent: Math.round(kept * 100), sameShape: kept >= SAME_SHAPE_KEEP,
      redraw: redraw ? { at: redraw.at, stale: redraw.from !== currentKey } : null,
      fileName: `${slug(sketch.title)}-${size.id}-${size.width}x${size.height}.jpg`,
      bytes: buf.length,
    },
  };
}

/**
 * What is sent to the edit model for a redraw: the sketch centred on white paper of the size's shape (longest side 1024), so the model
 * extends the scene into the white instead of squashing it.
 */
async function padForRedraw(image, sizeId) {
  const size = sizeById(sizeId);
  const src = dataUrlToBuffer(image);
  if (!size || !src) throw Object.assign(new Error('That size is not in the pack.'), { status: 400 });
  const r = size.width / size.height;
  const W = r >= 1 ? 1024 : Math.round(1024 * r);
  const H = r >= 1 ? Math.round(1024 / r) : 1024;
  const out = await sharp(src).rotate().flatten({ background: WHITE }).resize(W, H, { fit: 'contain', background: WHITE }).jpeg({ quality: 92 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

/** The redraw as it is kept: cut to the size's exact shape, longest side at most REDRAW_MAX_SIDE, JPEG. */
async function shapeRedraw(imageDataUrl, sizeId) {
  const size = sizeById(sizeId);
  const buf = dataUrlToBuffer(imageDataUrl);
  if (!size || !buf) throw new Error('The image service returned something that is not a picture');
  const scale = Math.min(1, REDRAW_MAX_SIDE / Math.max(size.width, size.height));
  const out = await sharp(buf).rotate().flatten({ background: WHITE })
    .resize(Math.round(size.width * scale), Math.round(size.height * scale), { fit: 'cover', position: sharp.strategy.attention })
    .jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

/** The words for a redraw. Nothing the person typed goes in: only the fixed look words for the sketch's own style. */
function buildRedrawPrompt({ styleWords, sizeId }) {
  const size = sizeById(sizeId);
  const shape = !size ? 'new' : (size.width > size.height * 1.05 ? 'wider' : (size.height > size.width * 1.05 ? 'taller' : 'square'));
  return [
    `This cartoon drawing has been placed on a ${shape} sheet with blank white space around it.`,
    'Extend the scene into the blank space so the picture fills the whole frame: continue the setting, ground and background naturally, in the same drawing style.',
    'Keep the existing drawing exactly as it is: the same characters, faces, clothes, positions and composition. Do not add new characters.',
    `Style: ${styleWords}.`,
    'No captions, no lettering, no watermark, no border or frame.',
  ].join('\n');
}

module.exports = {
  PACK_SIZES, MODES, MODE_IDS, AUTO_CROP_KEEP, SAME_SHAPE_KEEP,
  sizeById, keptShare, imageKey, checkMode, parseRedraws, resolveMode, makeSize, padForRedraw, shapeRedraw, buildRedrawPrompt, slug,
};
