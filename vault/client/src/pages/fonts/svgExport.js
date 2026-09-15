/**
 * Print handoff: flattened outlined-SVG export. Source of truth is the
 * SAME opentype.js `Font` object Phase 5's FontEffectsPanel already
 * parsed from the real Phase 4/5.5-exported font bytes for coverage
 * checking — not a second, independently-parsed source that could ever
 * disagree with what's on screen.
 *
 * Glyph outlines are flattened to `<path>` elements (never `<text>`), and
 * the active fill (solid/gradient/image) + shadow layers are baked in as
 * real SVG defs (linearGradient / pattern / feGaussianBlur), so the file
 * matches the live CSS preview without requiring the font installed.
 */

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function pathBounds(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) {
    const box = p.getBoundingBox();
    minX = Math.min(minX, box.x1);
    minY = Math.min(minY, box.y1);
    maxX = Math.max(maxX, box.x2);
    maxY = Math.max(maxY, box.y2);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function buildFillDefs(fill, bounds, idPrefix) {
  if (fill.mode === 'gradient') {
    const rad = (fill.gradientAngle * Math.PI) / 180;
    // CSS linear-gradient angle: 0deg = bottom-to-top, increases clockwise.
    // Convert to SVG objectBoundingBox x1/y1/x2/y2 (0..1) around the center.
    const dx = Math.sin(rad) / 2;
    const dy = -Math.cos(rad) / 2;
    const stops = fill.gradientStops
      .map((s) => `<stop offset="${s.position}%" stop-color="${escapeXml(s.color)}"/>`)
      .join('');
    return {
      defs: `<linearGradient id="${idPrefix}-fill" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${stops}</linearGradient>`,
      fillAttr: `url(#${idPrefix}-fill)`,
    };
  }
  if (fill.mode === 'image' && fill.imageDataUrl) {
    return {
      defs: `<pattern id="${idPrefix}-fill" patternUnits="userSpaceOnUse" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}">
        <image href="${fill.imageDataUrl}" x="0" y="0" width="${bounds.width}" height="${bounds.height}" preserveAspectRatio="xMidYMid slice"/>
      </pattern>`,
      fillAttr: `url(#${idPrefix}-fill)`,
    };
  }
  return { defs: '', fillAttr: fill.solidColor };
}

function buildShadowDefs(shadows, idPrefix) {
  return shadows.map((shadow, i) => {
    const blurStdDev = Math.max(0.01, shadow.blur / 2);
    return {
      filterId: `${idPrefix}-shadow-${i}`,
      offsetX: shadow.offsetX,
      offsetY: shadow.offsetY,
      color: shadow.color,
      defs: `<filter id="${idPrefix}-shadow-${i}" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="${blurStdDev}"/>
      </filter>`,
    };
  });
}

/**
 * @param {import('opentype.js').Font} font - parsed from the real Phase 4/5.5 export
 * @param {string} text
 * @param {number} fontSize
 * @param {object} fill - same shape as effectsCss.js DEFAULT_FILL
 * @param {object[]} shadows - same shape as effectsCss.js DEFAULT_SHADOW
 * @returns {string} standalone SVG markup
 */
export function buildOutlinedSvg(font, text, fontSize, fill, shadows) {
  const idPrefix = 'font-export';
  const paths = [];
  let penX = 0;
  const baselineY = 0;

  for (const ch of Array.from(text)) {
    const glyph = font.charToGlyph(ch);
    const path = glyph.getPath(penX, baselineY, fontSize);
    paths.push(path);
    penX += glyph.advanceWidth * (fontSize / font.unitsPerEm);
  }

  const bounds = pathBounds(paths);
  const padding = fontSize * 0.15;
  const viewBox = `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`;

  const { defs: fillDefs, fillAttr } = buildFillDefs(fill, bounds, idPrefix);
  const shadowDefs = buildShadowDefs(shadows, idPrefix);

  const pathD = paths.map((p) => p.toPathData(2)).join(' ');

  const shadowLayers = shadowDefs
    .map((s) => `<path d="${pathD}" fill="${escapeXml(s.color)}" filter="url(#${s.filterId})" transform="translate(${s.offsetX},${s.offsetY})"/>`)
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${Math.round(bounds.width + padding * 2)}" height="${Math.round(bounds.height + padding * 2)}">
  <defs>
    ${fillDefs}
    ${shadowDefs.map((s) => s.defs).join('\n    ')}
  </defs>
  <g>
    ${shadowLayers}
    <path d="${pathD}" fill="${fillAttr}"/>
  </g>
</svg>`;
}
