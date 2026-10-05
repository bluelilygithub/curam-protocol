// Fly-through camera path: the generic half, shared by Room Planner and Garden Planner (moved here from room-planner/src/render3d/tour.ts so the
// two cannot drift). Pure: no three.js, so the path is unit- and property-tested.
//
// A tour is a list of stops (a camera position and a point it looks at, with a rest time). Between stops the camera follows a centripetal
// Catmull-Rom curve (no overshoot), eased at each end, and rests at every stop. Legs between two stops marked `inside` are straight chords
// instead (Room Planner uses this to keep the camera inside a convex room). What the STOPS are, and what the camera must avoid, is each
// planner's own business.

export type Vec3 = [number, number, number];

/** Travel speed along a leg (m/s) and its clamps (s): long legs do not drag, short ones do not whip. */
export const TOUR_SPEED = 1.2;
export const MIN_LEG_SECONDS = 3;
export const MAX_LEG_SECONDS = 8;

export interface TourStop {
  position: Vec3;
  target: Vec3;
  /** Seconds the camera rests here. */
  dwell: number;
  label: string;
  source: 'saved' | 'auto';
  /** A stop whose legs to and from another `inside` stop are straight chords. */
  inside?: boolean;
  /** A waypoint the camera sweeps through without resting (it is not counted as a stop of the tour). */
  via?: boolean;
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

const len3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Seconds to travel a leg: distance at TOUR_SPEED, clamped. A waypoint to a waypoint is quicker. */
export function legSeconds(a: TourStop, b: TourStop): number {
  const d = Math.max(len3(a.position, b.position), len3(a.target, b.target) * 0.5);
  const min = a.via || b.via ? 1.5 : MIN_LEG_SECONDS;
  return Math.min(MAX_LEG_SECONDS, Math.max(min, d / TOUR_SPEED));
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
