// Camera presets and fitting (D43). Pure: positions are plain three-coordinate tuples (x, y up, z = plan y).
import type { Room } from '../engine/types';
import type { Vec3 } from './transforms';

export type Projection = 'perspective' | 'orthographic';

export interface CameraState {
  position: Vec3;
  target: Vec3;
  projection: Projection;
  /** Orthographic zoom (pixels per metre in three's ortho camera). Ignored for perspective. */
  zoom: number;
}

export type CameraPreset = 'iso' | 'top' | 'fit';

export const DEFAULT_FOV_DEG = 45;
/** Direction from the target to the camera for the isometric preset (≈ [10, 10, 10] for a room around the origin). */
export const ISO_DIRECTION: Vec3 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];

export interface RoomBounds { min: { x: number; y: number }; max: { x: number; y: number }; centre: Vec3; radius: number; width: number; depth: number }

/** Bounds of the room's corners plus its height. `radius` is half the diagonal of the bounding box (a sphere that holds the room). */
export function roomBounds(room: Room): RoomBounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of room.vertices) {
    x0 = Math.min(x0, v.position.x); x1 = Math.max(x1, v.position.x);
    y0 = Math.min(y0, v.position.y); y1 = Math.max(y1, v.position.y);
  }
  if (!Number.isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
  const width = x1 - x0;
  const depth = y1 - y0;
  const h = room.wallHeight;
  return {
    min: { x: x0, y: y0 }, max: { x: x1, y: y1 }, width, depth,
    centre: [(x0 + x1) / 2, h / 2, (y0 + y1) / 2],
    radius: Math.max(0.5, Math.hypot(width, depth, h) / 2),
  };
}

/** Distance from the target at which a sphere of `radius` fills the view (with margin) for a perspective camera. */
export function fitDistance(radius: number, fovDeg = DEFAULT_FOV_DEG, aspect = 1.6): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const half = Math.min(vFov, hFov) / 2;
  return (radius / Math.sin(half)) * 1.1;
}

/** Orthographic zoom (pixels per metre) that fits the room's footprint in a viewport of the given pixel size. */
export function orthoZoomFor(room: Room, viewportW: number, viewportH: number): number {
  const b = roomBounds(room);
  const span = Math.max(b.width, b.depth * 0.8 + room.wallHeight * 0.5, 0.5);
  return Math.max(1, (Math.min(viewportW, viewportH * 1.4) / span) * 0.8);
}

export interface PresetOptions { fovDeg?: number; aspect?: number; viewportW?: number; viewportH?: number; projection?: Projection }

/**
 * Camera for a preset. `iso` looks from the front-right and above, `top` straight down with plan +y toward the bottom of the
 * screen (as in the 2D view), `fit` re-frames the room keeping the direction of `current`.
 */
export function presetCamera(room: Room, preset: CameraPreset, current: CameraState | null, opts: PresetOptions = {}): CameraState {
  const b = roomBounds(room);
  const projection = opts.projection ?? current?.projection ?? 'perspective';
  const d = fitDistance(b.radius, opts.fovDeg ?? DEFAULT_FOV_DEG, opts.aspect ?? 1.6);
  const zoom = orthoZoomFor(room, opts.viewportW ?? 1000, opts.viewportH ?? 700);
  let dir: Vec3;
  let target: Vec3 = b.centre;
  if (preset === 'top') {
    target = [b.centre[0], 0, b.centre[2]];
    dir = [0, 1, 0.0005]; // not exactly vertical, so "up" stays defined
  } else if (preset === 'fit' && current) {
    const v: Vec3 = [current.position[0] - current.target[0], current.position[1] - current.target[1], current.position[2] - current.target[2]];
    const len = Math.hypot(...v) || 1;
    dir = [v[0] / len, v[1] / len, v[2] / len];
  } else {
    dir = ISO_DIRECTION;
  }
  const n = Math.hypot(...dir);
  return {
    position: [target[0] + (dir[0] / n) * d, target[1] + (dir[1] / n) * d, target[2] + (dir[2] / n) * d],
    target, projection, zoom,
  };
}

/** Plan-view angle of the camera from straight down (0 = looking straight down), used for wall fading. */
export function polarFromVertical(position: Vec3, target: Vec3): number {
  const dx = position[0] - target[0], dy = position[1] - target[1], dz = position[2] - target[2];
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dy / len)));
}

/**
 * Re-express a camera in the other projection so the framing barely changes: the visible height at the target is kept.
 * perspective → orthographic: zoom = viewport height / visible height; orthographic → perspective: distance from the zoom.
 */
export function convertProjection(c: CameraState, to: Projection, viewportH: number, fovDeg = DEFAULT_FOV_DEG): CameraState {
  if (c.projection === to) return c;
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const v: Vec3 = [c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]];
  const d = Math.hypot(...v) || 1;
  if (to === 'orthographic') {
    return { ...c, projection: to, zoom: Math.max(1, viewportH / (2 * d * t)) };
  }
  const nd = Math.max(0.5, viewportH / (2 * Math.max(1e-6, c.zoom) * t));
  return {
    ...c, projection: to,
    position: [c.target[0] + (v[0] / d) * nd, c.target[1] + (v[1] / d) * nd, c.target[2] + (v[2] / d) * nd],
  };
}
