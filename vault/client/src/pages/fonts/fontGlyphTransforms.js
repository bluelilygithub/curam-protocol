/**
 * Live-preview glyph transforms, applied entirely client-side to an
 * opentype.js Path (glyph.getPath(...).commands) before it's drawn on
 * canvas. These are visual APPROXIMATIONS for designer feedback only —
 * they never touch the font binary. The real, precise structural edits
 * (equivalent outline/contour operations, but exact and reversible) happen
 * server-side via fontTools in a later phase. See vault/CLAUDE.md's
 * "structural edits belong in the binary, rendering effects belong in the
 * layout layer" principle — this module lives entirely on the preview
 * side of that line.
 */

const Y_FIELDS = ['y', 'y1', 'y2'];
const X_FIELDS = ['x', 'x1', 'x2'];

function mapCommandFields(commands, fields, mapFn) {
  return commands.map((cmd) => {
    const next = { ...cmd };
    for (const f of fields) {
      if (typeof next[f] === 'number') next[f] = mapFn(next[f]);
    }
    return next;
  });
}

/**
 * Proportional Width: horizontal scale of the glyph outline around its own
 * left-side-bearing origin (originX). Advance width scaling is handled
 * separately by the caller (fontCanvasRenderer) so glyph shape and spacing
 * scale together consistently.
 */
export function applyProportionalWidth(commands, originX, scalePercent) {
  const scale = scalePercent / 100;
  if (scale === 1) return commands;
  return commands.map((cmd) => {
    const next = { ...cmd };
    for (const f of X_FIELDS) {
      if (typeof next[f] === 'number') next[f] = originX + (next[f] - originX) * scale;
    }
    return next;
  });
}

/**
 * Extend Ascenders/Descenders: stretches only the parts of the outline
 * above cap-height and below the baseline, leaving the x-height/cap-height
 * body untouched — an "extend the parts that stick out" transform rather
 * than a uniform vertical scale.
 *
 * `baselineY`/`capHeightLineY` are in canvas pixel coordinates (y grows
 * downward), as returned by opentype.js's getPath(x, y, fontSize).
 * `amount` is -100..100 (%); positive extends, negative compresses.
 */
export function applyExtendAscDesc(commands, baselineY, capHeightLineY, amount) {
  const factor = amount / 100;
  if (factor === 0) return commands;

  const mapY = (y) => {
    if (y <= capHeightLineY) {
      // Above cap height (smaller y = higher on screen) — ascender region.
      const distAboveCap = capHeightLineY - y;
      return capHeightLineY - distAboveCap * (1 + factor);
    }
    if (y >= baselineY) {
      // Below baseline — descender region.
      const distBelowBaseline = y - baselineY;
      return baselineY + distBelowBaseline * (1 + factor);
    }
    return y; // x-height/cap-height body: untouched
  };

  return mapCommandFields(commands, Y_FIELDS, mapY);
}

/**
 * Split a flat commands array (M...Z, M...Z, ...) into per-contour arrays.
 */
function splitContours(commands) {
  const contours = [];
  let current = [];
  for (const cmd of commands) {
    current.push(cmd);
    if (cmd.type === 'Z') {
      contours.push(current);
      current = [];
    }
  }
  if (current.length) contours.push(current);
  return contours;
}

function contourBounds(contour) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const cmd of contour) {
    for (const f of X_FIELDS) {
      if (typeof cmd[f] === 'number') { minX = Math.min(minX, cmd[f]); maxX = Math.max(maxX, cmd[f]); }
    }
    for (const f of Y_FIELDS) {
      if (typeof cmd[f] === 'number') { minY = Math.min(minY, cmd[f]); maxY = Math.max(maxY, cmd[f]); }
    }
  }
  return { minX, maxX, minY, maxY, area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY) };
}

/**
 * Counter Width: widen/narrow the "hole" contours (counters/bowls — the
 * inner, smaller-area contours of letters like o/e/a/g) around their own
 * centroid, leaving the outer contour's overall proportions alone.
 *
 * Heuristic, not a true winding-direction analysis: the largest-area
 * contour in a glyph is treated as the outer shape and left unscaled;
 * every other contour is treated as a counter and scaled by `factor`.
 * Works well for the common Latin letterforms this preview targets;
 * documented here as an approximation, same as the other transforms.
 */
export function applyCounterWidth(commands, factor) {
  if (factor === 0) return commands;
  const contours = splitContours(commands);
  if (contours.length < 2) return commands; // no inner contour to treat as a counter

  const bounds = contours.map(contourBounds);
  const outerIdx = bounds.reduce((best, b, i) => (b.area > bounds[best].area ? i : best), 0);
  const scale = 1 + factor / 100;

  const out = [];
  contours.forEach((contour, i) => {
    if (i === outerIdx) {
      out.push(...contour);
      return;
    }
    const b = bounds[i];
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    for (const cmd of contour) {
      const next = { ...cmd };
      for (const f of X_FIELDS) {
        if (typeof next[f] === 'number') next[f] = cx + (next[f] - cx) * scale;
      }
      for (const f of Y_FIELDS) {
        if (typeof next[f] === 'number') next[f] = cy + (next[f] - cy) * scale;
      }
      out.push(next);
    }
  });
  return out;
}

/**
 * Stem Thickness: not an outline transform — applied at draw time as an
 * extra stroke on top of the normal fill (positive amount only, this is a
 * "fake bold" trick; there's no clean way to thin strokes without a real
 * offset-path/contour operation, which is fontTools' job in the export
 * phase). Returns a canvas lineWidth in px for the caller to apply.
 */
export function stemStrokeWidthPx(amount, fontSize) {
  if (amount <= 0) return 0;
  return (amount / 100) * (fontSize * 0.04); // modest, visually-tuned coefficient
}
