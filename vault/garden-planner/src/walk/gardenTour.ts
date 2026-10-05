// The garden fly-through: which stops the camera visits, and a guarantee that it never flies THROUGH the house, a fence, a structure, a tree
// trunk or a shrub. Pure (no three.js), so the path is tested. The curve and timing are shared with Room Planner (planner-core/render3d/tour).
//
// Stops are the saved views when there are two or more; otherwise they are chosen from the garden: an overview, the entrance (just inside the
// gate), then eye-level views from the far corners of the plot looking across it, ordered around the plot so the camera circles it. Where a
// leg would pass through something solid, a waypoint is added that lifts the camera over it (a crane move), so the camera sweeps over the
// house between two views instead of through it.
import { add, dist, normalize, pointInPolygonInclusive, scale, sub, distToPolygonBoundary } from '@planner-core/engine/geometry';
import { footprintCorners } from '@planner-core/engine/footprints';
import { sampleTour, tourFromStops, type Tour, type TourStop, type Vec3 } from '@planner-core/render3d/tour';
import type { Vec2 } from '@planner-core/types';
import type { GardenProject, SavedView } from '../domain/types';
import type { GrowthStage } from '../plants/growth';
import { plantSizeAt } from '../plants/growth';
import { plantById } from '../plants/plants';
import { buildWalkWorld, isWalkable, nearestWalkable, walkStart, WALK_EYE, type WalkWorld } from './walk';

export const TOUR_EYE = WALK_EYE;
export const TOUR_LOOK = 1.2;
export const AUTO_DWELL = 2.5;
export const SAVED_DWELL = 3;
/** Field of view while the tour plays (the walker's is wider). */
export const TOUR_FOV = 55;
/** How far above an obstacle the camera passes, and the margin around its footprint. */
export const CLEARANCE = 0.35;
export const MARGIN = 0.2;
/** The lowest the camera is allowed to go (never under the ground). */
export const MIN_CAMERA_Y = 0.5;
const MIN_FROM_ENTRANCE = 4;
const MAX_CORNER_VIEWS = 3;
const MAX_PASSES = 4;
const SAMPLES_PER_LEG = 48;

/** A solid the camera must stay out of: a footprint, and the heights it fills. */
export interface Volume {
  poly?: Vec2[];
  circle?: { c: Vec2; r: number };
  base: number;
  top: number;
  fence: boolean;
}

const FENCE_THICKNESS: Record<string, number> = { colorbond: 0.06, timber_paling: 0.08, brick: 0.2, hedge: 0.6 };
const PASSABLE_BELOW = 0.4;

function band(a: Vec2, b: Vec2, t: number): Vec2[] {
  const d = normalize(sub(b, a));
  const n = { x: -d.y * (t / 2), y: d.x * (t / 2) };
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
}

export interface TourWorld { volumes: Volume[]; walk: WalkWorld }

/** Everything solid in the garden, with the heights it fills, at this growth stage. */
export function buildTourWorld(p: GardenProject, stage: GrowthStage): TourWorld {
  const volumes: Volume[] = [];
  if (p.house) volumes.push({ poly: p.house.vertices.map((v) => v.position), base: 0, top: p.house.height, fence: false });
  if (p.boundary) {
    const v = p.boundary.vertices.map((q) => q.position);
    p.boundary.segments.forEach((seg, i) => {
      if (!seg || seg.fence === 'open' || !(seg.height > PASSABLE_BELOW)) return;
      volumes.push({ poly: band(v[i], v[(i + 1) % v.length], FENCE_THICKNESS[seg.fence] ?? 0.08), base: 0, top: seg.height, fence: true });
    });
  }
  for (const s of p.structures) {
    if (s.kind === 'gate') continue;
    volumes.push({ poly: footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1), rotation: s.rotation }), base: 0, top: s.height, fence: false });
  }
  for (const inst of p.plants) {
    const rec = plantById(inst.plantId);
    if (!rec) continue;
    const size = plantSizeAt(rec, stage);
    if (size.height <= PASSABLE_BELOW) continue;
    if (rec.type === 'tree' || rec.type === 'palm') {
      volumes.push({ circle: { c: inst.position, r: Math.min(0.4, Math.max(0.1, 0.08 + 0.012 * size.height)) }, base: 0, top: size.height, fence: false }); // the trunk
      volumes.push({ circle: { c: inst.position, r: Math.max(0.3, (size.spread / 2) * 0.9) }, base: size.height * 0.35, top: size.height, fence: false }); // the leaves
    } else {
      volumes.push({ circle: { c: inst.position, r: Math.min(size.height >= 0.6 ? 0.7 : 0.4, size.spread * (size.height >= 0.6 ? 0.35 : 0.25)) }, base: 0, top: size.height, fence: false });
    }
  }
  return { volumes, walk: buildWalkWorld(p, stage) };
}

/** Plan point of a three.js position: plan (x, y) is three (x, -y). */
const planOf = (p: Vec3): Vec2 => ({ x: p[0], y: -p[2] });

/** The height of the solid the camera is inside at `p`, or null when it is in the clear. */
export function blockedBy(w: TourWorld, p: Vec3): number | null {
  const at = planOf(p);
  const inGate = w.walk.gates.some((g) => pointInPolygonInclusive(at, g, 0));
  let worst: number | null = null;
  for (const v of w.volumes) {
    if (p[1] < v.base - CLEARANCE || p[1] > v.top + CLEARANCE) continue;
    if (v.fence && inGate) continue; // the gateway is open
    const hit = v.circle
      ? dist(at, v.circle.c) < v.circle.r + MARGIN
      : !!v.poly && (pointInPolygonInclusive(at, v.poly, 0) || distToPolygonBoundary(at, v.poly) < MARGIN);
    if (hit) worst = Math.max(worst ?? 0, v.top);
  }
  return worst;
}

// ------------------------------------------------------------------ stops

const at3 = (p: Vec2, y: number): Vec3 => [p.x, y, -p.y];

function signedArea(p: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i += 1) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
  return a / 2;
}

interface Corner { at: Vec2; inward: Vec2 }
function convexCorners(poly: Vec2[]): Corner[] {
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const out: Corner[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[(i - 1 + poly.length) % poly.length], v = poly[i], b = poly[(i + 1) % poly.length];
    const e1 = sub(v, a), e2 = sub(b, v);
    if ((e1.x * e2.y - e1.y * e2.x) * sign <= 1e-9) continue; // reflex or straight
    out.push({ at: v, inward: normalize(add(normalize(sub(a, v)), normalize(sub(b, v)))) });
  }
  return out;
}

const ccwAngle = (c: Vec2, from: Vec2, to: Vec2): number => {
  const d = ((Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(from.y - c.y, from.x - c.x)) * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
};

export interface Pose { position: Vec3; target: Vec3 }

/** No tree's leaves (or anything else raised off the ground) over this spot, so the camera can rise and descend here without passing through it. */
export function openAbove(w: TourWorld, q: Vec2): boolean {
  return !w.volumes.some((v) => v.base > 0 && v.top > TOUR_EYE && (v.circle ? dist(q, v.circle.c) < v.circle.r + MARGIN : !!v.poly && (pointInPolygonInclusive(q, v.poly, 0) || distToPolygonBoundary(q, v.poly) < MARGIN)));
}

/**
 * Somewhere to put an eye-level camera near `want`: a spot a person could stand, the camera is in the clear there, AND there is open sky above
 * it (a walker may stand under a tree's leaves, but a camera there would be filming leaves, and could only reach it by flying down through them).
 * Searches outward in rings; null if there is no such spot.
 */
export function freeSpot(w: TourWorld, want: Vec2): Vec2 | null {
  const ok = (q: Vec2): boolean => isWalkable(w.walk, q) && blockedBy(w, at3(q, TOUR_EYE)) === null && openAbove(w, q);
  if (ok(want)) return want;
  const near = nearestWalkable(w.walk, want);
  if (near && ok(near)) return near;
  for (let r = 0.25; r <= 8; r += 0.25) {
    for (let k = 0; k < 32; k += 1) {
      const a = (k / 32) * Math.PI * 2;
      const q = { x: want.x + Math.cos(a) * r, y: want.y + Math.sin(a) * r };
      if (ok(q)) return q;
    }
  }
  return null;
}

/** Stops chosen from the garden alone: [overview, entrance, far-corner views...]. `overview` is the Iso camera. */
export function autoGardenStops(p: GardenProject, w: TourWorld, overview: Pose): TourStop[] {
  const stops: TourStop[] = [{ position: overview.position, target: overview.target, dwell: AUTO_DWELL, label: 'Overview', source: 'auto' }];
  const walkAt = walkStart(w.walk);
  const startPos = walkAt ? freeSpot(w, walkAt.position) : null;
  if (!startPos) return stops;
  const start = { position: startPos };
  const centre = w.walk.centre;
  const lookAt = (from: Vec2): Vec2 => (w.walk.houseCentre && dist(w.walk.houseCentre, from) > 3 ? w.walk.houseCentre : add(centre, scale(sub(centre, from), 0.25)));
  stops.push({ position: at3(start.position, TOUR_EYE), target: at3(lookAt(start.position), TOUR_LOOK), dwell: AUTO_DWELL, label: 'Entrance', source: 'auto' });

  const plot = p.boundary ? p.boundary.vertices.map((v) => v.position) : [];
  const corners = plot.length >= 3 ? convexCorners(plot) : [];
  const candidates = corners
    .map((c) => ({ c, q: freeSpot(w, add(c.at, scale(c.inward, 1.5))) }))
    .filter((x): x is { c: Corner; q: Vec2 } => x.q !== null && dist(x.q, start.position) >= MIN_FROM_ENTRANCE);
  const far = [...candidates].sort((a, b) => dist(b.q, start.position) - dist(a.q, start.position) || a.q.x - b.q.x || a.q.y - b.q.y).slice(0, MAX_CORNER_VIEWS);
  far.sort((a, b) => ccwAngle(centre, start.position, a.q) - ccwAngle(centre, start.position, b.q));
  for (const q of far) stops.push({ position: at3(q.q, TOUR_EYE), target: at3(lookAt(q.q), TOUR_LOOK), dwell: AUTO_DWELL, label: 'Garden view', source: 'auto' });
  return stops;
}

const savedStop = (v: SavedView): TourStop => ({ position: [...v.cameraPosition], target: [...v.target], dwell: SAVED_DWELL, label: v.name, source: 'saved' });

export function stopsFor(p: GardenProject, w: TourWorld, overview: Pose): TourStop[] {
  const saved = p.savedViews ?? [];
  if (saved.length >= 2) return saved.map(savedStop);
  if (saved.length === 1) return [savedStop(saved[0]), ...autoGardenStops(p, w, overview).slice(1)];
  return autoGardenStops(p, w, overview);
}

// ------------------------------------------------------------------ keeping the camera out of solid things

/** Every sample of the path that is inside something solid (time and the height of the solid). */
export function pathProblems(tour: Tour, w: TourWorld, step = 0.1): Array<{ t: number; top: number }> {
  const out: Array<{ t: number; top: number }> = [];
  for (let t = 0; t <= tour.duration; t += step) {
    const top = blockedBy(w, samplePose(tour, t).position);
    if (top !== null) out.push({ t, top });
  }
  return out;
}

/** One cruising height for the whole tour: above the tallest solid thing in the garden, with room to spare. */
export const cruiseHeight = (w: TourWorld): number => Math.max(0, ...w.volumes.map((v) => v.top)) + CLEARANCE + 2;

/** Two waypoints in a row at the same place are one waypoint (keep the higher). */
function dedupeVias(list: TourStop[]): TourStop[] {
  const out: TourStop[] = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && last.via && s.via && Math.hypot(last.position[0] - s.position[0], last.position[1] - s.position[1], last.position[2] - s.position[2]) < 0.05) {
      if (s.position[1] > last.position[1]) out[out.length - 1] = s;
      continue;
    }
    out.push(s);
  }
  return out;
}

/**
 * Add waypoints that lift the camera over whatever a leg would pass through. A waypoint does not rest and is not counted as a stop. Repeats
 * (a lifted leg can bring a new problem) up to a few passes; a stop that is itself inside something solid is left alone (the person chose it).
 */
export function clearStops(stops: TourStop[], loop: boolean, w: TourWorld): TourStop[] {
  let list = stops;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const tour = tourFromStops(list, loop);
    const next: TourStop[] = [];
    let changed = false;
    for (let i = 0; i < list.length; i += 1) {
      next.push(list[i]);
      const hasLeg = i < list.length - 1 || (loop && list.length > 1);
      if (!hasLeg) continue;
      const seg = tour.segments.find((s) => s.kind === 'travel' && s.from === i);
      if (!seg) continue;
      let worst: number | null = null;
      for (let k = 0; k <= SAMPLES_PER_LEG; k += 1) {
        const top = blockedBy(w, samplePose(tour, seg.t0 + ((seg.t1 - seg.t0) * k) / SAMPLES_PER_LEG).position);
        if (top !== null) worst = Math.max(worst ?? 0, top);
      }
      if (worst === null) continue;
      const a = list[i], b = list[(i + 1) % list.length];
      const lift = Math.max(worst + CLEARANCE + 2, cruiseHeight(w)); // one cruising altitude for the whole tour, so nothing slopes down past a tall tree
      const via = (position: Vec3, target: Vec3): TourStop => ({ position, target, dwell: 0, label: 'Over', source: 'auto', via: true });
      if (!a.via && !b.via) {
        // a crane move: straight up from where the camera rests, across at the lifted height, straight down onto the next stop (a slanting
        // descent could clip a tall tree standing beside the stop)
        // straight up in two collinear hops (so the climb stays vertical until it is above everything), then across, then straight down
        const column = (s: TourStop, rising: boolean): TourStop[] => {
          if (s.position[1] >= lift - 0.01) return [];
          const half = via([s.position[0], s.position[1] + (lift - s.position[1]) * 0.5, s.position[2]], s.target);
          const top = via([s.position[0], lift, s.position[2]], s.target);
          return rising ? [half, top] : [top, half];
        };
        next.push(...column(a, true), ...column(b, false));
      } else {
        const mid = (x: Vec3, y: Vec3): Vec3 => [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2];
        const pos = mid(a.position, b.position);
        pos[1] = Math.max(pos[1], lift);
        next.push(via(pos, mid(a.target, b.target)));
      }
      changed = true;
    }
    list = dedupeVias(next);
    if (!changed) break;
  }
  return list;
}

export function buildGardenTour(p: GardenProject, w: TourWorld, overview: Pose, loop = true): Tour {
  return tourFromStops(clearStops(stopsFor(p, w, overview), loop, w), loop);
}

/** The camera pose at time `t`: the shared curve, never under the ground. */
export function samplePose(tour: Tour, t: number): { position: Vec3; target: Vec3; stop: number; travelling: boolean } {
  const s = sampleTour(tour, t);
  return { ...s, position: [s.position[0], Math.max(MIN_CAMERA_Y, s.position[1]), s.position[2]], target: [s.target[0], Math.max(0, s.target[1]), s.target[2]] };
}

/** The stops a person counts ("stop 2 of 4"): waypoints are not among them. */
export const countedStops = (tour: Tour): number => tour.stops.filter((s) => !s.via).length;
/** Which counted stop the camera is at or heading to (1-based position among the counted stops, as an index). */
export function countedIndex(tour: Tour, t: number): number {
  const s = samplePose(tour, t);
  const n = tour.stops.length;
  let i = s.travelling ? (s.stop + 1) % n : s.stop;
  while (tour.stops[i]?.via && i < n + n) i = (i + 1) % n;
  return tour.stops.slice(0, i).filter((x) => !x.via).length;
}
