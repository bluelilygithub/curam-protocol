// Pure maths for draggable floating elements (see client/src/hooks/useDraggable.js). No DOM here, so it is
// tested with: node client/src/utils/dragPosition.test.mjs
//
// An element keeps its normal CSS position (for example `fixed bottom-5 right-5`) and is moved with
// `transform: translate(x, y)`. That translation is the "offset". `base` is where the element sits with a
// zero offset ({ left, top, width, height } in viewport pixels).

export const MARGIN = 8;          // always keep this much of a gap to the screen edge
export const DRAG_THRESHOLD = 4;  // pixels of movement before a press becomes a drag (so a click still clicks)

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Keep the whole element on the screen. If it is bigger than the screen it stays pinned to its start edge.
export function clampOffset(offset, base, viewport, margin = MARGIN) {
  const minX = margin - base.left;
  const maxX = viewport.width - margin - (base.left + base.width);
  const minY = margin - base.top;
  const maxY = viewport.height - margin - (base.top + base.height);
  return {
    x: clamp(offset.x, minX, Math.max(minX, maxX)),
    y: clamp(offset.y, minY, Math.max(minY, maxY)),
  };
}

export function isDrag(dx, dy, threshold = DRAG_THRESHOLD) {
  return Math.hypot(dx, dy) >= threshold;
}

// A saved position is only trusted if it is two finite numbers; anything else means "not moved".
export function parseOffset(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: Math.round(o.x), y: Math.round(o.y) };
  } catch { /* fall through */ }
  return { x: 0, y: 0 };
}

export const sameOffset = (a, b) => a.x === b.x && a.y === b.y;
