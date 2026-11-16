'use strict';

// Generative expand ("AI fill" in Canvas Extend): make a picture bigger on any side and have the image model paint
// the new area so it continues the scene, instead of a plain colour.
//
// How it works, and why:
//  1. The whole padded canvas is worked on at most WORK_MAX px on its long side (the inpaint model works at about
//     1 megapixel, and the price is per picture, not per pixel).
//  2. The model gets: the shrunk picture in its place, the new area pre-filled with a heavily blurred mirror of the
//     picture (so the fill starts from the right colours rather than grey), and a mask that is white over the new
//     area plus OVERLAP px into the picture on each side that grew, so the seam is repainted and blends.
//  3. The model's answer is scaled up to the full padded size, and the ORIGINAL picture, at its full resolution, is
//     laid back on top with a soft edge over the overlap band. Only the new area is the model's; the picture itself
//     is never resampled or changed.
// A see-through picture is flattened onto white first (the model has no transparency); the result is a JPEG.

const sharp = require('sharp');

const WORK_MAX = 1024;
const OVERLAP = 16; // working pixels repainted inside the picture along each edge that grows
const MAX_OUTPUT_MEGAPIXELS = 40;
const DEFAULT_PROMPT = 'Continue the surrounding scene naturally beyond the edges of the photo, matching its lighting, colours, perspective, texture and level of detail. No text, no borders, no frames, no new people.';

/** Geometry only (no pictures): working scale, sizes and the rectangle of the picture inside the canvas. */
function planExpand({ width, height, top = 0, right = 0, bottom = 0, left = 0 }) {
  const W = width + left + right;
  const H = height + top + bottom;
  const s = Math.min(1, WORK_MAX / Math.max(W, H));
  const ww = Math.max(16, Math.round(W * s));
  const wh = Math.max(16, Math.round(H * s));
  const ow = Math.max(1, Math.min(ww, Math.round(width * s)));
  const oh = Math.max(1, Math.min(wh, Math.round(height * s)));
  const wl = Math.min(ww - ow, Math.round(left * s));
  const wt = Math.min(wh - oh, Math.round(top * s));
  const wr = ww - ow - wl;
  const wb = wh - oh - wt;
  // The part of the picture the model must leave alone: inset by OVERLAP on every side that grows.
  const keep = {
    x0: wl + (left > 0 ? OVERLAP : 0),
    y0: wt + (top > 0 ? OVERLAP : 0),
    x1: wl + ow - (right > 0 ? OVERLAP : 0),
    y1: wt + oh - (bottom > 0 ? OVERLAP : 0),
  };
  // Full-resolution width of the soft edge when the original is laid back on top.
  const band = Math.max(2, Math.round(OVERLAP / s));
  return { W, H, s, ww, wh, ow, oh, wl, wt, wr, wb, keep, band };
}

/** Throws a 400 for a request that cannot be done, before anything is spent. */
function checkExpand({ width, height, top, right, bottom, left }) {
  const pads = [top, right, bottom, left];
  if (pads.some((p) => !Number.isFinite(p) || p < 0)) throw Object.assign(new Error('Padding must be 0 or more pixels'), { status: 400 });
  if (pads.every((p) => p === 0)) throw Object.assign(new Error('Add space on at least one side'), { status: 400 });
  // The model can only invent so much convincingly: at most double the picture's size on each axis.
  if (left + right > width * 2 || top + bottom > height * 2) {
    throw Object.assign(new Error('AI fill can add at most twice the picture\'s width and height. Add less space, or run it twice.'), { status: 400 });
  }
  const W = width + left + right;
  const H = height + top + bottom;
  if ((W * H) / 1e6 > MAX_OUTPUT_MEGAPIXELS) {
    throw Object.assign(new Error(`The result would be ${Math.round((W * H) / 1e6)} megapixels; the most is ${MAX_OUTPUT_MEGAPIXELS}. Shrink the picture first or add less space.`), { status: 400 });
  }
}

/** The picture and mask sent to the model, as PNG buffers. `flat` is the oriented, flattened original. */
async function buildModelInputs(flat, plan) {
  const { ww, wh, ow, oh, wl, wt, wr, wb, keep } = plan;
  const small = await sharp(flat).resize(ow, oh, { fit: 'fill' }).png().toBuffer();
  const guide = await sharp(small)
    .extend({ top: wt, bottom: wb, left: wl, right: wr, extendWith: 'mirror' })
    .blur(Math.max(4, Math.round(Math.max(ww, wh) / 30)))
    .png()
    .toBuffer();
  const image = await sharp(guide).composite([{ input: small, left: wl, top: wt }]).png().toBuffer();

  const kw = Math.max(0, keep.x1 - keep.x0);
  const kh = Math.max(0, keep.y1 - keep.y0);
  let mask = sharp({ create: { width: ww, height: wh, channels: 3, background: '#ffffff' } });
  if (kw > 0 && kh > 0) {
    const black = await sharp({ create: { width: kw, height: kh, channels: 3, background: '#000000' } }).png().toBuffer();
    mask = mask.composite([{ input: black, left: keep.x0, top: keep.y0 }]);
  }
  const maskBuf = await sharp(await mask.png().toBuffer()).blur(2).png().toBuffer();
  return { image, mask: maskBuf };
}

/** Lay the full-resolution original back over the model's (scaled-up) answer with a soft edge where it grew. */
async function assemble(flat, modelOut, plan, pads, { width, height }) {
  const { W, H, band } = plan;
  const base = await sharp(modelOut).resize(W, H, { fit: 'fill' }).toBuffer();
  const half = Math.round(band / 2);
  const rx = pads.left > 0 ? half : -band;
  const ry = pads.top > 0 ? half : -band;
  const rx1 = pads.right > 0 ? width - half : width + band;
  const ry1 = pads.bottom > 0 ? height - half : height + band;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${rx}" y="${ry}" width="${Math.max(1, rx1 - rx)}" height="${Math.max(1, ry1 - ry)}" fill="#fff"/></svg>`;
  const alpha = await sharp(Buffer.from(svg)).blur(Math.max(0.5, band / 4)).png().toBuffer();
  const soft = await sharp(flat).ensureAlpha().composite([{ input: alpha, blend: 'dest-in' }]).png().toBuffer();
  return sharp(base).composite([{ input: soft, left: pads.left, top: pads.top }]).jpeg({ quality: 92 }).toBuffer();
}

/**
 * Expand a picture with AI fill. `inpaint({ imageDataUrl, maskDataUrl, prompt, strength })` is the model call
 * (inpaintWithFal in production; a stub in tests) and must resolve `{ imageDataUrl, seed, image }`.
 */
async function expandImage(buffer, pads, { prompt, inpaint, seed }) {
  const meta = await sharp(buffer).metadata();
  const oriented = meta.orientation >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  const p = {
    top: Math.floor(Number(pads.top) || 0),
    right: Math.floor(Number(pads.right) || 0),
    bottom: Math.floor(Number(pads.bottom) || 0),
    left: Math.floor(Number(pads.left) || 0),
  };
  checkExpand({ ...oriented, ...p });
  const flat = await sharp(buffer).rotate().flatten({ background: '#ffffff' }).png().toBuffer();
  const plan = planExpand({ ...oriented, ...p });
  const { image, mask } = await buildModelInputs(flat, plan);
  const result = await inpaint({
    imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
    maskDataUrl: `data:image/png;base64,${mask.toString('base64')}`,
    prompt: String(prompt || '').trim() || DEFAULT_PROMPT,
    strength: 0.95,
    seed,
  });
  const b64 = String(result?.imageDataUrl || '').split(',')[1];
  if (!b64) throw new Error('The AI service returned no picture');
  const out = await assemble(flat, Buffer.from(b64, 'base64'), plan, p, oriented);
  return { buffer: out, width: plan.W, height: plan.H, seed: result.seed, image: result.image };
}

module.exports = { planExpand, checkExpand, buildModelInputs, assemble, expandImage, DEFAULT_PROMPT, WORK_MAX, OVERLAP };
