import { goldenCase02, internalSize, type WallSide } from '../enclosure';
import { BOTTLE_PROFILES } from '../engine/defaults';
import type { BottleProfileId } from '../engine/types';
import { ESTIMATE_FIELDS, APP_SCHEMA, BEST_GUESS_RACK, analyseApp, type AppProject, type RunPlacement } from '../app/model';
import { fillWall, type RackRun } from '../placement';
import { DEFAULT_CONFIG, type LiteConfig } from './config';

// The public "lite" tool: a handful of choices that become a normal AppProject (the same one the full planner opens), plus a short design code
// that carries those choices and nothing else (no personal data). Every figure it produces is an ESTIMATE from best-guess rack values.

export const LITE_VERSION = 1;
export const WALLS: readonly WallSide[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
export const BOTTLES: readonly BottleProfileId[] = ['BORDEAUX', 'BURGUNDY', 'CHAMPAGNE', 'MAGNUM'];
export type LiteMode = 'FILL' | 'TARGET';
export type DoorStyle = 'SINGLE' | 'DOUBLE';
/** Typical opening widths (unconfirmed): one 970 mm leaf as on the sample drawings, or two leaves of 750 mm. */
export const LITE_DOOR_WIDTH_MM: Record<DoorStyle, number> = { SINGLE: 970, DOUBLE: 1500 };

export interface LiteSettings {
  /** Inside size in whole millimetres. */
  widthMm: number;
  depthMm: number;
  heightMm: number;
  doorWall: WallSide;
  /** One door leaf or two. */
  doorStyle: DoorStyle;
  bottle: BottleProfileId;
  mode: LiteMode;
  /** Bottles wanted (TARGET mode only). */
  target: number;
}

/** The width of the one standard rack unit every estimate is built from (a typical size, not a confirmed supplier value). */
export const LITE_UNIT_WIDTH_MM = BEST_GUESS_RACK.unitWidthMm as number;

export const LIMITS = {
  widthMm: [1000, 8000], depthMm: [1000, 8000], heightMm: [2000, 3200], target: [1, 5000],
} as const;

export const defaultLite = (): LiteSettings => ({ widthMm: 2750, depthMm: 1565, heightMm: 2150, doorWall: 'SOUTH', doorStyle: 'SINGLE', bottle: 'BORDEAUX', mode: 'FILL', target: 500 });

const clamp = (n: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/** Keep every value inside its allowed range (a typed or decoded value can never produce an unbuildable size). */
export function normaliseLite(s: LiteSettings): LiteSettings {
  return {
    widthMm: clamp(s.widthMm, LIMITS.widthMm), depthMm: clamp(s.depthMm, LIMITS.depthMm), heightMm: clamp(s.heightMm, LIMITS.heightMm),
    doorWall: WALLS.includes(s.doorWall) ? s.doorWall : 'SOUTH',
    doorStyle: s.doorStyle === 'DOUBLE' ? 'DOUBLE' : 'SINGLE',
    bottle: BOTTLES.includes(s.bottle) ? s.bottle : 'BORDEAUX',
    mode: s.mode === 'TARGET' ? 'TARGET' : 'FILL',
    target: clamp(s.target, LIMITS.target),
  };
}

/** The door's width: the typical width for its style, reduced (to an even number of mm for a double door) when the door wall is too short to hold it with a post either side. */
function doorWidth(s: LiteSettings, outerW: number, outerD: number, cfg: LiteConfig): number {
  const wall = s.doorWall === 'NORTH' || s.doorWall === 'SOUTH' ? outerW : outerD;
  const room = wall - 200;
  const fit = s.doorStyle === 'DOUBLE' ? Math.floor(room / 2) * 2 : room;
  return Math.max(0, Math.min(s.doorStyle === 'DOUBLE' ? cfg.doors.doubleMm : cfg.doors.singleMm, fit));
}

/** Build the project: the Carter Noir sample enclosure resized to the chosen inside size, best-guess racks on every wall, trimmed to a target if asked. */
export function liteToProject(input: LiteSettings, cfg: LiteConfig = DEFAULT_CONFIG): AppProject {
  const s = normaliseLite(input);
  const g = goldenCase02();
  const outerW = s.widthMm + g.walls.WEST.buildUpMm + g.walls.EAST.buildUpMm;
  const outerD = s.depthMm + g.walls.NORTH.buildUpMm + g.walls.SOUTH.buildUpMm;
  const enclosure = {
    ...g,
    outerWidthMm: outerW,
    outerDepthMm: outerD,
    heightMm: s.heightMm + g.ceilingBuildUpMm + g.floorBuildUpMm,
    door: { ...g.door, wall: s.doorWall, widthMm: doorWidth(s, outerW, outerD, cfg), ...(s.doorStyle === 'DOUBLE' ? { leaves: 2 as const } : {}) },
    // the sample's conditioner and vents sit at positions measured for a 2850 mm header; drop any that no longer fit a narrower room
    header: g.header.filter((c) => c.xMm + c.widthMm <= outerW),
  };
  // best-guess racks, made deep and tall-pitched enough for the chosen bottle (a magnum does not fit the 350 x 100 mm guess)
  const prof = BOTTLE_PROFILES[s.bottle];
  // the owner's unit width and height; a unit can never be taller than the room it stands in
  const spec = { ...BEST_GUESS_RACK, unitWidthMm: cfg.rack.unitWidthMm, unitHeightMm: Math.min(cfg.rack.unitHeightMm, s.heightMm), unitDepthMm: Math.max(350, Math.ceil((prof.lengthMm + 15) / 50) * 50), rowPitchMm: Math.max(100, prof.diameterMm + 5) };
  const unitW = spec.unitWidthMm as number, unitD = spec.unitDepthMm as number;
  const strip = ({ id, wall, startMm, units }: RackRun): RunPlacement => ({ id, wall, startMm, units });
  const inner = internalSize(enclosure);
  const runs: RunPlacement[] = [];
  // north and south own the corners and run the full length; east and west fit between them
  for (const wall of ['NORTH', 'SOUTH', 'WEST', 'EAST'] as const) {
    const f = fillWall(enclosure, wall, spec, s.bottle, wall.toLowerCase());
    if (f.status !== 'OK') continue;
    const len = wall === 'NORTH' || wall === 'SOUTH' ? inner.widthMm : inner.depthMm;
    for (const r of f.runs) {
      if (wall === 'NORTH' || wall === 'SOUTH') { runs.push(strip(r)); continue; }
      const a = Math.max(r.startMm, unitD), b = Math.min(r.startMm + r.units * unitW, len - unitD);
      const units = Math.floor((b - a) / unitW);
      if (units > 0) runs.push({ id: r.id, wall, startMm: a, units });
    }
  }
  const base: AppProject = { schemaVersion: APP_SCHEMA, name: 'Lite design (estimate)', enclosure, rackSpec: spec, bottle: s.bottle, runs, walkwayMm: null, estimated: [...ESTIMATE_FIELDS] };
  return s.mode === 'TARGET' ? trimToTarget(base, s.target) : base;
}

const total = (p: AppProject): number => { const t = analyseApp(p).racks.total; return t.status === 'OK' ? t.capacity : 0; };

/** Remove whole units (east, west, then south, north; last run first) until one more removal would fall below the target. Never adds units. */
export function trimToTarget(p: AppProject, target: number): AppProject {
  let cur = p;
  if (total(cur) <= target) return cur;
  for (const wall of ['EAST', 'WEST', 'SOUTH', 'NORTH'] as const) {
    for (;;) {
      const idx = [...cur.runs.keys()].reverse().find((i) => cur.runs[i].wall === wall && cur.runs[i].units > 0);
      if (idx === undefined) break;
      const next = { ...cur, runs: cur.runs.map((r, i) => (i === idx ? { ...r, units: r.units - 1 } : r)).filter((r) => r.units > 0) };
      if (total(next) < target) return cur;
      cur = next;
    }
  }
  return cur;
}

/** What the person sees: the estimate, and anything plain-language that stops the design being built. */
export function liteResult(s: LiteSettings, cfg: LiteConfig = DEFAULT_CONFIG): { project: AppProject; bottles: number; maxBottles: number; problems: string[] } {
  const ns = normaliseLite(s);
  const project = liteToProject(ns, cfg);
  const a = analyseApp(project);
  const problems = a.issues.filter((i) => i.severity === 'error').map((i) => i.message);
  const maxBottles = ns.mode === 'TARGET' ? total(liteToProject({ ...ns, mode: 'FILL' }, cfg)) : total(project);
  return { project, bottles: total(project), maxBottles, problems };
}

// ---- design code: CL1.<base64url of a compact JSON array>. Settings only. The leading version lets later versions change the shape.

const b64 = (t: string): string => btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (t: string): string => atob(t.replace(/-/g, '+').replace(/_/g, '/'));

export function encodeDesign(input: LiteSettings): string {
  const s = normaliseLite(input);
  return `CL${LITE_VERSION}.${b64(JSON.stringify([s.widthMm, s.depthMm, s.heightMm, WALLS.indexOf(s.doorWall), BOTTLES.indexOf(s.bottle), s.mode === 'TARGET' ? 1 : 0, s.target, s.doorStyle === 'DOUBLE' ? 1 : 0]))}`;
}

/** Null when the text is not a design code (or is from a newer version this build cannot read). Out-of-range values are clamped, never trusted. */
export function decodeDesign(text: string): LiteSettings | null {
  const m = /^CL(\d+)\.([A-Za-z0-9_-]+)$/.exec(text.trim());
  if (!m || Number(m[1]) !== LITE_VERSION) return null;
  try {
    const a: unknown = JSON.parse(unb64(m[2]));
    if (!Array.isArray(a) || (a.length !== 7 && a.length !== 8) || !a.every((n) => typeof n === 'number')) return null;
    // the eighth value (door style) is absent from codes made before double doors existed: those were single doors
    const [widthMm, depthMm, heightMm, w, b, mode, target, door] = a as number[];
    return normaliseLite({ widthMm, depthMm, heightMm, doorWall: WALLS[w] ?? 'SOUTH', doorStyle: door === 1 ? 'DOUBLE' : 'SINGLE', bottle: BOTTLES[b] ?? 'BORDEAUX', mode: mode === 1 ? 'TARGET' : 'FILL', target });
  } catch { return null; }
}

/** The number of whole rack units in a project (what the price is worked from). */
export const rackUnitCount = (p: AppProject): number => p.runs.reduce((n, r) => n + r.units, 0);

/** One plain line for the enquiry. */
export function summaryLine(s: LiteSettings, bottles: number, cfg: LiteConfig = DEFAULT_CONFIG): string {
  const n = normaliseLite(s);
  return `Inside ${n.widthMm} x ${n.depthMm} x ${n.heightMm} mm, ${n.doorStyle === 'DOUBLE' ? 'double' : 'single'} door on the ${n.doorWall.toLowerCase()} wall, ${BOTTLE_PROFILES[n.bottle].label}, about ${bottles} bottles using standard rack units about ${cfg.rack.unitWidthMm} mm wide (estimate only, final site measure required)`;
}
