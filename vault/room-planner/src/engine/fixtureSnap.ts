import { quantizeLinear } from './coordinates';
import { FIXTURE_END_MARGIN, wallGeometry } from './constraints';
import { distPointSegment, dot, sub } from './geometry';
import type { Room, Vec2 } from './types';

/** A4: default `fixtureWallSnapDistance`, a configurable interaction preference. */
export const FIXTURE_WALL_SNAP_DISTANCE = 0.5;

export interface FixtureSnap {
  wallId: string;
  /** Centre of the fixture along the wall, from the wall's start vertex (C8), quantized and clamped. */
  offsetAlongWall: number;
  /** Distance from the pointer to the wall's interior face. */
  distance: number;
  /** The unclamped projection of the pointer would have left the legal range. */
  clamped: boolean;
  /** Unit vector along the wall (start → end) and the interior normal: the ghost's orientation. */
  dir: Vec2;
  normal: Vec2;
}

/**
 * Wall-snap for the fixture ghost (A4). The pointer snaps to the nearest wall whose interior face is within
 * `snapDistance`; the offset is clamped so each opening edge stays 50 mm from the wall end (C8). A wall too short
 * for the fixture (width > L − 0.1 m) is never a candidate. Ties go to the smaller distance, then the wall id.
 */
export function snapFixtureToWall(
  room: Room, pointer: Vec2, width: number, snapDistance = FIXTURE_WALL_SNAP_DISTANCE,
): FixtureSnap | null {
  let best: FixtureSnap | null = null;
  for (const wall of room.walls) {
    const g = wallGeometry(room, wall.id);
    if (!g) continue;
    if (width > g.length - 2 * FIXTURE_END_MARGIN) continue;
    const d = distPointSegment(pointer, g.start, g.end);
    if (d > snapDistance) continue;
    const lo = width / 2 + FIXTURE_END_MARGIN;
    const hi = g.length - width / 2 - FIXTURE_END_MARGIN;
    const raw = dot(sub(pointer, g.start), g.dir);
    // Quantizing a clamp bound that is not on the 1 mm grid could step outside the legal range: round inward instead.
    const loMm = Math.ceil(lo * 1000 - 1e-6) / 1000;
    const hiMm = Math.floor(hi * 1000 + 1e-6) / 1000;
    const q = quantizeLinear(Math.min(hi, Math.max(lo, raw)));
    const snap: FixtureSnap = {
      wallId: wall.id,
      offsetAlongWall: Math.min(hiMm, Math.max(loMm, q)),
      distance: d,
      clamped: raw < lo || raw > hi,
      dir: g.dir,
      normal: g.normal,
    };
    if (!best || d < best.distance - 1e-12 || (Math.abs(d - best.distance) <= 1e-12 && snap.wallId < best.wallId)) best = snap;
  }
  return best;
}
