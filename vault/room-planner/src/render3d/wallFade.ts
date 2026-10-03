// Wall fading while orbiting (A7, D42): walls that stand between the camera and the inside of the room are faded so the room stays
// visible. A wall fades when the camera is on the OUTER side of its inside face (its outside is what the camera sees), or when the
// plan-view line from the camera to the room centre crosses its drawn outline (the A7 wording, which this rule contains for a
// convex room). Off when the camera looks (nearly) straight down, and in orthographic top-down views, where no wall hides
// anything. Pure.
import { EPSILON } from '../engine/coordinates';
import { dot, pointInPolygonInclusive, segmentsTouch, sub } from '../engine/geometry';
import { wallGeometry } from '../engine/constraints';
import { wallOutlines } from '../engine/wallOutline';
import type { Room, Vec2 } from '../engine/types';

/** Polar angle from straight down (radians) under which nothing fades: looking from above, walls do not block the view. */
export const FADE_MIN_POLAR = (20 * Math.PI) / 180;

export function roomCentre(room: Room): Vec2 {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of room.vertices) {
    x0 = Math.min(x0, v.position.x); x1 = Math.max(x1, v.position.x);
    y0 = Math.min(y0, v.position.y); y1 = Math.max(y1, v.position.y);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/**
 * Ids of walls to fade for a camera at plan position `camera`. `polar` is the angle between the view direction and straight down
 * (0 = looking straight down). `centre` defaults to the room's bounding-box centre.
 */
export function wallsToFade(room: Room, camera: Vec2, polar: number, centre: Vec2 = roomCentre(room)): string[] {
  if (polar < FADE_MIN_POLAR) return [];
  const outlines = wallOutlines(room.vertices, room.walls);
  const ids: string[] = [];
  for (const o of outlines) {
    if (!o.wallId) continue;
    // A camera above the wall itself would otherwise fade the wall it stands over.
    if (pointInPolygonInclusive(camera, o.polygon, 0)) continue;
    const poly = o.polygon;
    const g = wallGeometry(room, o.wallId);
    let hides = !!g && dot(sub(camera, g.start), g.normal) < -EPSILON; // camera on the outer side of the wall's inside face
    for (let i = 0; i < poly.length && !hides; i++) hides = segmentsTouch(camera, centre, poly[i], poly[(i + 1) % poly.length]);
    if (hides) ids.push(o.wallId);
  }
  return ids.sort();
}
