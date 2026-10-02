import { add, scale } from './geometry';
import type { FurnitureInstance, Interval, Metres, Vec2 } from './types';

/**
 * Local-frame convention (the spec leaves handedness open; fixed here and used everywhere):
 *  - local +X = "right", local -X = "left", width runs along local X
 *  - local +Y = "front", local -Y = "back", length runs along local Y
 *  - rotation is the counter-clockwise angle of local X from world +X
 */
export interface OrientedRect { position: Vec2; width: Metres; length: Metres; rotation: number }

export function localAxes(rotation: number): { u: Vec2; v: Vec2 } {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return { u: { x: c, y: s }, v: { x: -s, y: c } };
}

/** Corners in CCW order: (-,-), (+,-), (+,+), (-,+) in the local frame. */
export function footprintCorners(r: OrientedRect): Vec2[] {
  const { u, v } = localAxes(r.rotation);
  const hw = r.width / 2;
  const hl = r.length / 2;
  const at = (sx: number, sy: number): Vec2 => add(r.position, add(scale(u, sx * hw), scale(v, sy * hl)));
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

export const footprintOf = (i: FurnitureInstance): Vec2[] => footprintCorners(i);

export const verticalInterval = (i: { elevation: Metres; height: Metres }): Interval => ({
  min: i.elevation,
  max: i.elevation + i.height,
});

/** Resize handle: -1 / 0 / +1 per local axis. (0,0) is invalid. */
export interface ResizeHandle { x: -1 | 0 | 1; y: -1 | 0 | 1 }

/**
 * Pure resize helper (B3): the edge/corner opposite the dragged handle stays fixed, the centre moves
 * accordingly. Returns raw (unquantized) values; the commit pipeline quantizes them.
 */
export function resizeAboutAnchor(
  rect: OrientedRect,
  handle: ResizeHandle,
  newWidth: Metres,
  newLength: Metres,
): { position: Vec2; width: Metres; length: Metres } {
  const { u, v } = localAxes(rect.rotation);
  const width = handle.x === 0 ? rect.width : newWidth;
  const length = handle.y === 0 ? rect.length : newLength;
  // Shift of the centre along each local axis: the fixed edge sits at -handle * size/2 from the centre.
  const du = handle.x * ((width - rect.width) / 2);
  const dv = handle.y * ((length - rect.length) / 2);
  return { position: add(rect.position, add(scale(u, du), scale(v, dv))), width, length };
}

export function localToWorld(rect: OrientedRect, local: Vec2): Vec2 {
  const { u, v } = localAxes(rect.rotation);
  return add(rect.position, add(scale(u, local.x), scale(v, local.y)));
}
