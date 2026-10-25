import type { Cue } from './api';
import type { Lines, Pos } from './geo';

/**
 * Written directions worked out from the SHAPE of a line, on the device, with no routing service: "Head north-east", "Turn left", ..., "Arrive". It works for any line (drawn, imported, planned, old), instantly, and never fails. It cannot know street
 * names; when the routing service has given real directions with street names those are used instead.
 *
 * How: the line is thinned so GPS wobble and tiny kinks do not become turns (a point is kept when the line strays more than SIMPLIFY_M from a
 * straight run), then each corner is a turn by how far the heading changes: a gentle change is "bear", a clear one is "turn", a sharp one is
 * "turn sharp", an about-turn is "make a U-turn". A step's distance is how far the person goes before the next instruction.
 */

const SIMPLIFY_M = 15;
const BEAR_MIN = 25; // below this the heading change is not worth saying
const TURN_MIN = 55;
const SHARP_MIN = 125;
const UTURN_MIN = 160;
const MAX_STEPS = 400;
const M_PER_DEG = 111320;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Metres between two points (flat patch of earth: fine at walking-route scale). */
function dist(a: Pos, b: Pos): number {
  const k = Math.cos(rad((a[1] + b[1]) / 2));
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * M_PER_DEG;
}

/** Compass heading from a to b in degrees, 0 = north, 90 = east. */
function heading(a: Pos, b: Pos): number {
  const k = Math.cos(rad((a[1] + b[1]) / 2));
  const deg = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassName = (deg: number): string => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

/** The signed change of heading from one leg to the next, -180 to 180: negative is left, positive is right. */
function change(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/** Douglas-Peucker in metres: keep a point only when the line strays more than `tol` from a straight run. */
function thin(pts: Pos[], tol: number): Pos[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const off = (p: Pos, a: Pos, b: Pos): number => {
    const k = Math.cos(rad(a[1]));
    const ax = a[0] * k * M_PER_DEG, ay = a[1] * M_PER_DEG, bx = b[0] * k * M_PER_DEG, by = b[1] * M_PER_DEG, px = p[0] * k * M_PER_DEG, py = p[1] * M_PER_DEG;
    const dx = bx - ax, dy = by - ay; const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop() as [number, number];
    let worst = 0; let at = -1;
    for (let k = i + 1; k < j; k += 1) { const d = off(pts[k], pts[i], pts[j]); if (d > worst) { worst = d; at = k; } }
    if (at >= 0 && worst > tol) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return pts.filter((_, k) => keep[k] === 1);
}

function turnWords(delta: number): string {
  const side = delta < 0 ? 'left' : 'right';
  const size = Math.abs(delta);
  if (size >= UTURN_MIN) return 'Make a U-turn';
  if (size >= SHARP_MIN) return `Turn sharp ${side}`;
  if (size >= TURN_MIN) return `Turn ${side}`;
  return `Bear ${side}`;
}

/** The directions for a line, in the same shape the routing service's directions have, so the list, Copy, .txt and PDF all work on them. */
export function turnCues(lines: Lines): Cue[] {
  const raw = lines.flat().filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (raw.length < 2) return [];
  let tol = SIMPLIFY_M;
  let pts = thin(raw, tol);
  for (let i = 0; i < 20 && pts.length > MAX_STEPS; i += 1) { tol *= 1.5; pts = thin(raw, tol); } // a very long, twisty line: only the bigger turns
  const legs = pts.slice(1).map((p, i) => ({ from: pts[i], to: p, m: dist(pts[i], p), h: heading(pts[i], p) }));
  if (!legs.length) return [];
  const cues: Cue[] = [];
  let run = { startAt: pts[0], m: legs[0].m, instruction: `Head ${compassName(legs[0].h)}` };
  for (let i = 1; i < legs.length; i += 1) {
    const d = change(legs[i - 1].h, legs[i].h);
    if (Math.abs(d) < BEAR_MIN) { run.m += legs[i].m; continue; } // a gentle kink: keep going
    cues.push({ text: run.instruction, distanceM: Math.round(run.m), durationS: null, type: null, pos: run.startAt });
    run = { startAt: legs[i].from, m: legs[i].m, instruction: turnWords(d) };
  }
  cues.push({ text: run.instruction, distanceM: Math.round(run.m), durationS: null, type: null, pos: run.startAt });
  const end = pts[pts.length - 1];
  cues.push({ text: 'Arrive at the end of the route', distanceM: 0, durationS: null, type: 10, pos: end });
  return cues;
}
