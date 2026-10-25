'use strict';

// Real text widths for the Graphics tools that draw text into an SVG (Watermark, Text Overlay,
// Composite, Batch Text). The SVG is drawn in "Arial", which on the hosted site is Liberation Sans
// (same letter widths, installed by the Dockerfile); on a Windows dev machine it is Arial itself.
// We measure with whichever of those files is on this machine. If none can be read we fall back
// to the old flat 0.62-of-font-size per character, so text never fails to draw.

const fs = require('fs');
const opentype = require('opentype.js');

const FONT_FILES = {
  regular: [
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
  ],
  bold: [
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
    'C:\\Windows\\Fonts\\arialbd.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  ],
};

const FALLBACK_EM_PER_CHAR = 0.62;
const cache = {}; // 'regular' | 'bold' -> opentype Font, or null once we know there is none

function loadFont(kind) {
  if (kind in cache) return cache[kind];
  cache[kind] = null;
  for (const file of FONT_FILES[kind]) {
    try {
      const buf = fs.readFileSync(file);
      cache[kind] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      break;
    } catch { /* try the next location */ }
  }
  return cache[kind];
}

/** True for the font-weight values the Graphics routes pass around ('bold', 'bolder', 600-900). */
function isBold(fontWeight) {
  return /^(bold|bolder|[6-9]00)$/i.test(String(fontWeight || '').trim());
}

/** Width in pixels of `text` drawn at `fontSize` px. `fontWeight` is optional ('bold' or 'normal'). */
function measureTextWidth(text, fontSize, fontWeight) {
  const str = String(text || '');
  const font = loadFont(isBold(fontWeight) ? 'bold' : 'regular');
  if (!font) return str.length * fontSize * FALLBACK_EM_PER_CHAR;
  return font.getAdvanceWidth(str, fontSize);
}

module.exports = { measureTextWidth, isBold };
