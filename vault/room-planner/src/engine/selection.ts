import { EPSILON } from './coordinates';
import { CUT_PLANE_HEIGHT } from './cutPlane';
import { fixtureCentre, wallGeometry } from './constraints';
import { footprintOf } from './footprints';
import { aabbOf, add, dist, pointInPolygonInclusive, scale } from './geometry';
import { wallOutlines } from './wallOutline';
import type { Room, Vec2 } from './types';

export type SelectionKind = 'furniture' | 'fixture' | 'wall';
export interface SelectionRef { kind: SelectionKind; id: string }

export const sameRef = (a: SelectionRef, b: SelectionRef): boolean => a.kind === b.kind && a.id === b.id;

export interface PickOptions {
  /** Extra reach around shapes, in world metres (typically a few screen pixels). */
  tolerance?: number;
  cutPlane?: number;
}

/** True for objects drawn dashed in 2D (A13): elevation + height > cut-plane, with EPSILON tolerance (0.8 + 0.4 is not "above" 1.2). */
export const isAboveCutPlane = (i: { elevation: number; height: number }, cutPlane = CUT_PLANE_HEIGHT): boolean =>
  i.elevation + i.height > cutPlane + EPSILON;

/**
 * Every object under `point`, in picking order (B6): furniture first with objects above the cut-plane before floor-level ones
 * (higher top first, then id), then fixtures, then walls. Selection state is not touched here.
 */
export function pickAll(room: Room, point: Vec2, opts: PickOptions = {}): SelectionRef[] {
  const tol = opts.tolerance ?? 0.02;
  const cut = opts.cutPlane ?? CUT_PLANE_HEIGHT;
  const hits: SelectionRef[] = [];

  const furniture = room.furniture
    .filter((f) => pointInPolygonInclusive(point, footprintOf(f), tol))
    .sort((a, b) => {
      const ha = isAboveCutPlane(a, cut) ? 1 : 0;
      const hb = isAboveCutPlane(b, cut) ? 1 : 0;
      return hb - ha || b.elevation + b.height - (a.elevation + a.height) || (a.id < b.id ? -1 : 1);
    });
  for (const f of furniture) hits.push({ kind: 'furniture', id: f.id });

  const wallBand = new Map(wallOutlines(room.vertices, room.walls).map((o) => [o.wallId, o]));
  for (const f of [...room.fixtures].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const g = wallGeometry(room, f.wallId);
    if (!g) continue;
    const t = wallBand.get(f.wallId)?.thickness ?? 0.15;
    const c = fixtureCentre(g, f);
    // Opening rectangle: width along the wall, thickness outward from the interior face.
    const a = add(c, scale(g.dir, -f.width / 2));
    const b = add(c, scale(g.dir, f.width / 2));
    const quad = [a, b, add(b, scale(g.normal, -t)), add(a, scale(g.normal, -t))];
    if (pointInPolygonInclusive(point, quad, tol)) hits.push({ kind: 'fixture', id: f.id });
  }

  for (const o of wallOutlines(room.vertices, room.walls)) {
    if (o.wallId && pointInPolygonInclusive(point, o.polygon, tol)) hits.push({ kind: 'wall', id: o.wallId });
  }
  return hits;
}

/**
 * Marquee selection (B6): an object is selected only if its entire footprint is inside the marquee rectangle.
 * Fixtures count when their whole opening segment is inside. Walls are never marquee-selected.
 */
export function marqueeSelect(room: Room, a: Vec2, b: Vec2): SelectionRef[] {
  const min = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const max = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  const inside = (p: Vec2): boolean => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
  const out: SelectionRef[] = [];
  for (const f of room.furniture) {
    const box = aabbOf(footprintOf(f));
    if (inside(box.min) && inside(box.max)) out.push({ kind: 'furniture', id: f.id });
  }
  for (const fx of room.fixtures) {
    const g = wallGeometry(room, fx.wallId);
    if (!g) continue;
    const c = fixtureCentre(g, fx);
    const e1 = add(c, scale(g.dir, -fx.width / 2));
    const e2 = add(c, scale(g.dir, fx.width / 2));
    if (inside(e1) && inside(e2)) out.push({ kind: 'fixture', id: fx.id });
  }
  return out.sort((x, y) => (x.kind === y.kind ? (x.id < y.id ? -1 : 1) : x.kind < y.kind ? -1 : 1));
}

export interface PickCycleState {
  /** Screen position (pixels) of the last click that produced this cycle. */
  screen: Vec2;
  time: number;
  index: number;
}

/** Repeated clicks on the same screen point within this window cycle deeper (B6). */
export const CYCLE_WINDOW_MS = 500;
export const CYCLE_SLOP_PX = 4;

/**
 * B6 cycle rule: the first click selects the nearest hit; further clicks at the same screen point within 500 ms
 * (a double-click window extended to triple) move to the next hit. Returns the chosen ref and the new cycle state.
 */
export function cyclePick(
  hits: SelectionRef[], screen: Vec2, now: number, prev: PickCycleState | null,
): { pick: SelectionRef | null; state: PickCycleState | null } {
  if (hits.length === 0) return { pick: null, state: null };
  const continuing = prev && now - prev.time <= CYCLE_WINDOW_MS && dist(prev.screen, screen) <= CYCLE_SLOP_PX;
  const index = continuing ? (prev.index + 1) % hits.length : 0;
  return { pick: hits[index], state: { screen, time: now, index } };
}
