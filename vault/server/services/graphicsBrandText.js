'use strict';

// Text in the person's brand font (docs/brand-from-url.md, step 6). Used by Text Overlay and the text layers of Composite.
//
// The text is NOT drawn with a font name. It is turned into vector outlines (SVG <path>) with opentype.js from the stored font file, and
// those outlines go into the same SVG the overlay always built. That avoids everything that went wrong with named fonts in the
// Linux/Windows check: librsvg ignores @font-face, an unregistered name silently draws a different font (a different one per system),
// and sharp's own text input shows colour fringes on thin strokes. The widths used for wrapping and for the box come from the same font
// file the outlines come from, so the box fits the text exactly.
//
// Limits (Latin text only): no ligatures or contextual shapes beyond pair kerning, no right-to-left, and only the Latin part of a font is
// stored (docs/brand-from-url.md). Characters the font does not have draw as its "missing glyph" box.

const opentype = require('opentype.js');
const crypto = require('crypto');
const kitStore = require('./graphicsBrandKit');

const SOURCES = { 'brand-heading': 'heading', 'brand-body': 'body' };
const KERNING = { kerning: true };

class BrandTextError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

/** 'brand-heading' | 'brand-body' -> 'heading' | 'body'; anything else (including nothing) -> null, meaning the standard font. */
function brandRoleOf(fontSource) {
  return SOURCES[String(fontSource || '')] || null;
}

// Parsed fonts, by file hash: parsing a font costs a few milliseconds, and a Composite can ask for the same one several times.
const parsed = new Map();
const MAX_PARSED = 12;

function parseFontBuffer(buf, sha) {
  const key = sha || crypto.createHash('sha256').update(buf).digest('hex');
  if (parsed.has(key)) return parsed.get(key);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (parsed.size >= MAX_PARSED) parsed.delete(parsed.keys().next().value);
  parsed.set(key, font);
  return font;
}

/**
 * The font the person saved in their Brand Kit for a role, ready to measure and draw with. Throws BrandTextError (409, plain words) when
 * there is none or it cannot be read, so the screen can say so instead of quietly drawing in another font.
 */
async function loadBrandFont(db, userId, fontSource) {
  const role = brandRoleOf(fontSource);
  if (!role) return null;
  const row = await kitStore.getFontFile(db, userId, role);
  if (!row) {
    throw new BrandTextError(`No brand ${role} font is saved. Open Brand Kit, read a website and tick the ${role} font, or pick another font.`);
  }
  try {
    return { font: parseFontBuffer(row.data, row.sha256), family: row.family, weight: row.weight, role };
  } catch {
    throw new BrandTextError(`The saved brand ${role} font could not be read. Read the website again in Brand Kit.`);
  }
}

/** Width in px of one line at `size` px, with pair kerning. */
function measure(font, text, size) {
  return font.getAdvanceWidth(String(text), size, KERNING);
}

/** Line height that always fits the font (some fonts are much taller than Arial), never less than the standard 1.25. */
function lineHeightFor(font, size) {
  const em = font.unitsPerEm || 1000;
  const content = ((font.ascender || 0.8 * em) - (font.descender || -0.2 * em)) / em * size;
  return Math.max(Math.ceil(size * 1.25), Math.ceil(content * 1.05));
}

/**
 * SVG path data for one line. `x` is the anchor point (start, middle or end of the line, matching `anchor`), `top` the top of the line's
 * box; the baseline is placed so the font's own ascent and descent sit centred in the line.
 */
function linePathData(font, text, { x, top, size, lineHeight, anchor }) {
  const em = font.unitsPerEm || 1000;
  const asc = ((font.ascender || 0.8 * em) / em) * size;
  const desc = ((font.descender || -0.2 * em) / em) * size;
  const baseline = top + (lineHeight - (asc - desc)) / 2 + asc;
  const w = measure(font, text, size);
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return font.getPath(String(text), left, baseline, size, KERNING).toPathData(2);
}

/**
 * One centred label (a watermark or a batch caption) as an SVG <path> of outlines, for a box of `width` x `height` px. The box height is at
 * least what the font needs. `color` must already be a checked #rrggbb. Returns { markup, width, height } where width/height are the box
 * sizes to use (the label's width plus `padX` on both sides, and the taller of `height` and the font's own line height).
 */
function centredLabel(font, text, { size, padX, minHeight, color, opacity }) {
  const width = Math.ceil(measure(font, text, size)) + padX;
  const height = Math.max(minHeight, lineHeightFor(font, size));
  const d = linePathData(font, text, { x: width / 2, top: 0, size, lineHeight: height, anchor: 'middle' });
  return { markup: `<path d="${d}" fill="${color}" fill-opacity="${opacity}" />`, width, height };
}

module.exports = { brandRoleOf, loadBrandFont, measure, lineHeightFor, linePathData, centredLabel, BrandTextError, parseFontBuffer };
