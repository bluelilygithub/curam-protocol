// Fly-through camera path (Spec Addition A1, C3, D53). Pure: no three.js, so the path is unit- and property-tested.
//
// Stops are the saved views when there are two or more; otherwise they are chosen from the room: an overview, the entrance (just
// inside the first door), then the diagonal view from each far convex corner, ordered around the room so the camera circles it.
// Between stops the camera follows a centripetal Catmull–Rom curve (no overshoot), eased at each end, and rests at every stop. Legs
// between two eye-level stops inside the room are straight chords instead, which cannot leave a convex room.
import { fixtureCentre, wallGeometry } from '../engine/constraints';
import { add, dist, normalize, pointInPolygonInclusive, scale, sub } from '../engine/geometry';
import type { Room, SavedView, Vec2 } from '../engine/types';
import { presetCamera } from './cameraPresets';
import type { Vec3 } from './transforms';

export const EYE_HEIGHT = 1.55;
export const LOOK_HEIGHT = 1.0;
/** Travel speed along a leg (m/s) and its clamps (s): long legs do not drag, short ones do not whip. */
export const TOUR_SPEED = 1.2;
export const MIN_LEG_SECONDS = 3;
export const MAX_LEG_SECONDS = 8;
export const SAVED_DWELL = 3;
export const AUTO_DWELL = 2.5;
const CORNER_INSET = [0.45, 0.3, 0.18];
const MIN_FROM_ENTRANCE = 1.5;
const MAX_DIAGONALS = 3;

export interface TourStop {
  position: Vec3;
  target: Vec3;
  /** Seconds the camera rests here. */
  dwell: number;
  label: string;
  source: 'saved' | 'auto';
  /** An eye-level stop chosen inside the room: legs between two of these are straight chords, so a convex room keeps the camera inside. */
  inside?: boolean;
}

export interface TourSegment {
  kind: 'dwell' | 'travel';
  t0: number;
  t1: number;
  /** Dwell: the stop. Travel: the stop it leaves; it arrives at the next one (wrapping when the tour loops). */
  from: number;
}

export interface Tour {
  stops: TourStop[];
  segments: TourSegment[];
  /** Total seconds for one pass (a looping tour includes the leg back to the first stop). */
  duration: number;
  loop: boolean;
}

// ------------------------------------------------------------------ room helpers

function signedArea(p: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
  return a / 2;
}

/** Area centroid of the room polygon (falls back to the bounding-box centre for a degenerate polygon). */
export function roomCentroid(room: Room): Vec2 {
  const p = room.vertices.map((v) => v.position);
  const a = signedArea(p);
  if (Math.abs(a) < 1e-9) {
    const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    const f = p[i].x * q.y - q.x * p[i].y;
    cx += (p[i].x + q.x) * f;
    cy += (p[i].y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

const polygonOf = (room: Room): Vec2[] => room.vertices.map((v) => v.position);
const at = (p: Vec2, y: number): Vec3 => [p.x, y, p.y];

function entranceStop(room: Room, centre: Vec2): TourStop | null {
  const poly = polygonOf(room);
  const door = room.fixtures.find((f) => f.type === 'door');
  const g = door ? wallGeometry(room, door.wallId) : undefined;
  if (door && g) {
    const c = fixtureCentre(g, door);
    for (const inset of [0.6, 0.4, 0.2]) {
      const p = add(c, scale(g.normal, inset));
      if (pointInPolygonInclusive(p, poly, 0)) return { position: at(p, EYE_HEIGHT), target: at(centre, LOOK_HEIGHT), dwell: AUTO_DWELL, label: 'Entrance', source: 'auto', inside: true };
    }
  }
  return null;
}

interface Corner { at: Vec2; inward: Vec2 }

/** Convex corners of the room with their inward bisector, in vertex order. */
function convexCorners(room: Room): Corner[] {
  const p = polygonOf(room);
  const sign = signedArea(p) >= 0 ? 1 : -1;
  const out: Corner[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], v = p[i], b = p[(i + 1) % p.length];
    const e1 = sub(v, a), e2 = sub(b, v);
    const turn = (e1.x * e2.y - e1.y * e2.x) * sign;
    if (turn <= 1e-9) continue; // reflex or straight
    const bis = normalize(add(normalize(sub(a, v)), normalize(sub(b, v))));
    out.push({ at: v, inward: bis });
  }
  return out;
}

function standInside(poly: Vec2[], c: Corner): Vec2 | null {
  for (const inset of CORNER_INSET) {
    const p = add(c.at, scale(c.inward, inset));
    if (pointInPolygonInclusive(p, poly, 0)) return p;
  }
  return null;
}

/** Counter-clockwise angle (degrees, 0–360) from `from` to `to` around `centre`. */
function ccwAngle(centre: Vec2, from: Vec2, to: Vec2): number {
  const a = Math.atan2(from.y - centre.y, from.x - centre.x);
  const b = Math.atan2(to.y - centre.y, to.x - centre.x);
  let d = ((b - a) * 180) / Math.PI;
  d = ((d % 360) + 360) % 360;
  return d;
}

/** Stops chosen from the room alone: [overview?, entrance, far-corner diagonals…]. */
export function autoStops(room: Room, withOverview = true): TourStop[] {
  const poly = polygonOf(room);
  const centre = roomCentroid(room);
  const stops: TourStop[] = [];
  if (withOverview) {
    const cam = presetCamera(room, 'iso', null, { aspect: 16 / 9 });
    stops.push({ position: cam.position, target: cam.target, dwell: AUTO_DWELL, label: 'Overview', source: 'auto' });
  }
  const corners = convexCorners(room);
  let entrance = entranceStop(room, centre);
  if (!entrance) {
    const c = corners[0];
    const p = c ? standInside(poly, c) : null;
    if (p) entrance = { position: at(p, EYE_HEIGHT), target: at(centre, LOOK_HEIGHT), dwell: AUTO_DWELL, label: 'Entrance', source: 'auto', inside: true };
  }
  const entrancePlan: Vec2 | null = entrance ? { x: entrance.position[0], y: entrance.position[2] } : null;
  if (entrance) stops.push(entrance);

  const candidates = corners
    .map((c) => ({ c, p: standInside(poly, c) }))
    .filter((q): q is { c: Corner; p: Vec2 } => q.p !== null)
    .filter((q) => !entrancePlan || dist(q.p, entrancePlan) >= MIN_FROM_ENTRANCE);
  const refPoint = entrancePlan ?? { x: centre.x + 1, y: centre.y };
  const far = [...candidates].sort((a, b) => dist(b.p, refPoint) - dist(a.p, refPoint) || a.p.x - b.p.x || a.p.y - b.p.y).slice(0, MAX_DIAGONALS);
  far.sort((a, b) => ccwAngle(centre, refPoint, a.p) - ccwAngle(centre, refPoint, b.p));
  for (const q of far) {
    // look across the room: past the centre, on the line from the corner through it
    const look = add(centre, scale(sub(centre, q.p), 0.25));
    stops.push({ position: at(q.p, EYE_HEIGHT), target: at(look, LOOK_HEIGHT), dwell: AUTO_DWELL, label: 'Corner view', source: 'auto', inside: true });
  }
  return stops;
}

// ------------------------------------------------------------------ build

function savedStop(v: SavedView): TourStop {
  return { position: [...v.cameraPosition], target: [...v.target], dwell: SAVED_DWELL, label: v.name, source: 'saved' };
}

const len3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Seconds to travel a leg: distance at TOUR_SPEED, clamped. */
export function legSeconds(a: TourStop, b: TourStop): number {
  const d = Math.max(len3(a.position, b.position), len3(a.target, b.target) * 0.5);
  return Math.min(MAX_LEG_SECONDS, Math.max(MIN_LEG_SECONDS, d / TOUR_SPEED));
}

export function stopsFor(room: Room, savedViews: SavedView[]): TourStop[] {
  if (savedViews.length >= 2) return savedViews.map(savedStop);
  if (savedViews.length === 1) return [savedStop(savedViews[0]), ...autoStops(room, false)];
  return autoStops(room, true);
}

export function buildTour(room: Room, savedViews: SavedView[], loop = true): Tour {
  return tourFromStops(stopsFor(room, savedViews), loop);
}

export function tourFromStops(stops: TourStop[], loop: boolean): Tour {
  const segments: TourSegment[] = [];
  let t = 0;
  const n = stops.length;
  for (let i = 0; i < n; i++) {
    segments.push({ kind: 'dwell', t0: t, t1: t + stops[i].dwell, from: i });
    t += stops[i].dwell;
    const hasLeg = i < n - 1 || (loop && n > 1);
    if (hasLeg) {
      const next = stops[(i + 1) % n];
      const s = legSeconds(stops[i], next);
      segments.push({ kind: 'travel', t0: t, t1: t + s, from: i });
      t += s;
    }
  }
  return { stops, segments, duration: t, loop };
}

// ------------------------------------------------------------------ sampling

const EPS = 1e-9;

/** Centripetal Catmull–Rom (Barry–Goldman) through p1 → p2 for u in [0, 1]. */
export function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const knot = (t: number, a: Vec3, b: Vec3): number => t + Math.max(EPS, Math.sqrt(len3(a, b)));
  const t0 = 0, t1 = knot(t0, p0, p1), t2 = knot(t1, p1, p2), t3 = knot(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: Vec3, b: Vec3, ta: number, tb: number): Vec3 => {
    const w = tb - ta < EPS ? 0 : (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
  };
  const a1 = mix(p0, p1, t0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2), b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

export interface TourPose { position: Vec3; target: Vec3; stop: number; travelling: boolean }

/** Camera pose at time `t` seconds. A looping tour wraps; otherwise it holds the last stop. */
export function sampleTour(tour: Tour, t: number): TourPose {
  const { stops, segments } = tour;
  if (stops.length === 0) throw new RangeError('tour has no stops');
  let time = t;
  if (tour.loop && tour.duration > 0) time = ((t % tour.duration) + tour.duration) % tour.duration;
  time = Math.max(0, Math.min(time, tour.duration));
  const n = stops.length;
  const seg = segments.find((s) => time >= s.t0 && time <= s.t1) ?? segments[segments.length - 1];
  if (seg.kind === 'dwell') {
    const s = stops[seg.from];
    return { position: s.position, target: s.target, stop: seg.from, travelling: false };
  }
  const u = smooth((time - seg.t0) / Math.max(EPS, seg.t1 - seg.t0));
  const idx = (k: number): number => (tour.loop ? ((k % n) + n) % n : Math.max(0, Math.min(n - 1, k)));
  const i = seg.from;
  const next = stops[(i + 1) % n];
  if (stops[i].inside && next.inside) {
    const lerp = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    return { position: lerp(stops[i].position, next.position), target: lerp(stops[i].target, next.target), stop: i, travelling: true };
  }
  const pts = [idx(i - 1), i, idx(i + 1), idx(i + 2)].map((k) => stops[k]);
  return {
    position: catmullRom(pts[0].position, pts[1].position, pts[2].position, pts[3].position, u),
    target: catmullRom(pts[0].target, pts[1].target, pts[2].target, pts[3].target, u),
    stop: i, travelling: true,
  };
}

/** Which stop the camera is at or heading to (for the "stop 2 of 5" label). */
export const stopAt = (tour: Tour, t: number): number => {
  const p = sampleTour(tour, t);
  return p.travelling ? (p.stop + 1) % tour.stops.length : p.stop;
};

