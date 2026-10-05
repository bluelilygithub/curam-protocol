import type { AABB, Vec2 } from '../types';

/**
 * The 2D view transform. This is the ONLY place the screen's Y-down flip lives (Spec §4). It never enters the domain.
 * `scale` is pixels per metre; (offsetX, offsetY) is the canvas position of the world origin.
 */
export interface View { scale: number; offsetX: number; offsetY: number }

export const MIN_SCALE = 8; // px per metre
export const MAX_SCALE = 600;

export function worldToCanvas(p: Vec2, v: View): Vec2 {
  return { x: v.offsetX + p.x * v.scale, y: v.offsetY - p.y * v.scale };
}

export function canvasToWorld(c: Vec2, v: View): Vec2 {
  return { x: (c.x - v.offsetX) / v.scale, y: (v.offsetY - c.y) / v.scale };
}

/** World metres per screen pixel (B10 uses this to decide how much to declutter). */
export const metresPerPixel = (v: View): number => 1 / v.scale;

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Fit a world-space box into a viewport with padding (px). */
export function fitView(box: AABB, viewport: { width: number; height: number }, padding = 64): View {
  const w = Math.max(box.max.x - box.min.x, 0.5);
  const h = Math.max(box.max.y - box.min.y, 0.5);
  const scale = clampScale(Math.min((viewport.width - 2 * padding) / w, (viewport.height - 2 * padding) / h));
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  return { scale, offsetX: viewport.width / 2 - cx * scale, offsetY: viewport.height / 2 + cy * scale };
}

/** Zoom about a screen point so the world point under it stays put. */
export function zoomAt(v: View, screen: Vec2, factor: number): View {
  const scale = clampScale(v.scale * factor);
  const world = canvasToWorld(screen, v);
  return { scale, offsetX: screen.x - world.x * scale, offsetY: screen.y + world.y * scale };
}

export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy };
}
