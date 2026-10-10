import { advisories, analyseEnclosure, goldenCase02, type Advisory, type Enclosure, type EnclosureAnalysis, type WallSide } from '../enclosure';
import type { BottleProfileId, Issue } from '../engine/types';
import { analyseRacks, fillWall, type RackLayoutAnalysis, type RackRun } from '../placement';
import { blankRackSpec, type RackSpec } from '../rack';

// What the glass-enclosure screens edit: the enclosure, ONE rack specification shared by every run (blank until real values are entered),
// the runs, and the project's own minimum walkway (blank = not set, so that check does not run).

export const APP_SCHEMA = 1;

export interface RunPlacement { id: string; wall: WallSide; startMm: number; units: number }

/** The rack specification fields a test case can fill with guesses. Each loses its "estimated" marker the moment the person edits it. */
export const ESTIMATE_FIELDS = ['unitWidthMm', 'unitDepthMm', 'unitHeightMm', 'rowPitchMm', 'orientation', 'postsPerUnit'] as const;
export type EstimateField = (typeof ESTIMATE_FIELDS)[number];

export interface AppProject {
  schemaVersion: typeof APP_SCHEMA;
  name: string;
  enclosure: Enclosure;
  rackSpec: RackSpec;
  bottle: BottleProfileId;
  runs: RunPlacement[];
  walkwayMm: number | null;
  /** The catalogue rack type the rack values came from (Settings -> Cellar Planner). A copy: the numbers live in `rackSpec`, so a later catalogue change never alters this design. `confirmed` = the supplier's values at the time. */
  rackType?: { id: string; name: string; confirmed: boolean };
  /** The rack finish shown in the 3D view and printed pictures (colour only: it never changes a count). */
  finish?: 'OAK' | 'WALNUT' | 'BLACK';
  /** This design's own temperatures for the cooling estimate (otherwise the Settings defaults are used). */
  cooling?: { ambientC?: number; targetC?: number };
  /** The website enquiry this design was opened from (Vault CRM). Lets a quote be logged on the enquiry's deal. */
  lead?: { id: number; name: string };
  /** Rack fields whose values are BEST GUESSES (a test case), not supplier values. Empty or absent for a real design. */
  estimated?: EstimateField[];
  /** Title-block details for the drawing package (kept with the design). The date is set when the package is made. */
  drawing?: { company: string; client: string; address: string; projectNo: string; drawnBy: string; checkedBy: string };
}

/** The starting project: the Carter Noir sample enclosure as read (unverified), NO rack values, NO walkway minimum. */
export function sampleProject(): AppProject {
  return { schemaVersion: APP_SCHEMA, name: 'Sample enclosure (A101 as read)', enclosure: goldenCase02(), rackSpec: blankRackSpec(), bottle: 'BORDEAUX', runs: [], walkwayMm: null };
}

/**
 * A ready-made test case: the sample enclosure with racks on every wall, filled with BEST-GUESS rack values so there are bottles to count. The
 * guesses are invented, not a supplier's: a 600 x 350 mm unit, 2000 mm tall, a 100 mm row pitch (the spacing on the sample drawing), neck-out,
 * 2 posts. Bottles per row is calculated (600 / the 85 mm Bordeaux pitch = 7). Every guess is marked "estimated" until the person overwrites it. The minimum
 * walkway stays blank: it is the business's number, not a guess.
 */
/** Bottles per row is NOT a guess here: left blank it is calculated from the unit width and the chosen bottle's pitch, so changing the bottle changes the count. */
export const BEST_GUESS_RACK: RackSpec = { unitWidthMm: 600, unitDepthMm: 350, unitHeightMm: 2000, rowPitchMm: 100, bottlesPerRow: null, bottlesPerRowLabelForward: null, orientation: 'NECK_OUT', postsPerUnit: 2, rowsPerUnit: null };

/**
 * Put the best guesses into every rack field that is still BLANK, leaving anything the person has entered alone, and mark just those fields
 * estimated. Pure: returns the same object when there is nothing to fill.
 */
export function fillBlankRackWithGuesses(p: AppProject): AppProject {
  const blank = ESTIMATE_FIELDS.filter((k) => p.rackSpec[k] === null || p.rackSpec[k] === undefined);
  if (!blank.length) return p;
  const rackSpec = { ...p.rackSpec } as RackSpec;
  for (const k of blank) (rackSpec as unknown as Record<string, unknown>)[k] = BEST_GUESS_RACK[k];
  return { ...p, rackSpec, estimated: [...new Set([...(p.estimated ?? []), ...blank])] };
}

export function testCaseProject(): AppProject {
  const base = sampleProject();
  const rackSpec: RackSpec = { ...BEST_GUESS_RACK };
  const strip = ({ id, wall, startMm, units }: RackRun): RunPlacement => ({ id, wall, startMm, units });
  const runs: RunPlacement[] = [];
  for (const wall of ['NORTH', 'SOUTH'] as const) {
    const f = fillWall(base.enclosure, wall, rackSpec, base.bottle, wall.toLowerCase());
    if (f.status === 'OK') runs.push(...f.runs.map(strip));
  }
  // one unit on each side wall, starting past the north run's depth so the corners do not overlap
  runs.push({ id: 'west-1', wall: 'WEST', startMm: rackSpec.unitDepthMm as number, units: 1 }, { id: 'east-1', wall: 'EAST', startMm: rackSpec.unitDepthMm as number, units: 1 });
  return { ...base, name: 'Test case (estimated rack values)', rackSpec, runs, estimated: [...ESTIMATE_FIELDS] };
}

export const fullRuns = (p: AppProject): RackRun[] => p.runs.map((r) => ({ ...r, spec: p.rackSpec, bottle: p.bottle }));

export interface Analysis {
  enclosure: EnclosureAnalysis;
  racks: RackLayoutAnalysis;
  issues: Issue[];
  advisories: Advisory[];
}

/** Everything the screens show: checks, totals and advisories, from the pure engines. */
export function analyseApp(p: AppProject): Analysis {
  const enclosure = analyseEnclosure(p.enclosure);
  const racks = analyseRacks(p.enclosure, fullRuns(p), { walkwayMm: p.walkwayMm });
  return { enclosure, racks, issues: [...enclosure.issues, ...racks.issues], advisories: advisories(p.enclosure) };
}

/** Errors first, then warnings, then information; stable within each. */
export function sortIssues(issues: Issue[]): Issue[] {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return issues.map((i, n) => ({ i, n })).sort((a, b) => rank[a.i.severity] - rank[b.i.severity] || a.n - b.n).map((x) => x.i);
}

const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 200) : '');

export class ParseError extends Error {}

export const serializeApp = (p: AppProject): string => JSON.stringify(p, null, 2);

/** Parse a saved project. Rejects other files; fills in what an older file lacks (a missing rack spec stays blank, never zero). */
export function deserializeApp(text: string): AppProject {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ParseError('That is not a Cellar Planner file.'); }
  const o = raw as Partial<AppProject> | null;
  if (!o || typeof o !== 'object' || o.schemaVersion !== APP_SCHEMA || !o.enclosure || typeof o.enclosure !== 'object' || !o.enclosure.walls || !o.enclosure.door) {
    throw new ParseError('That is not a Cellar Planner file.');
  }
  const base = sampleProject();
  return {
    schemaVersion: APP_SCHEMA,
    name: typeof o.name === 'string' && o.name.trim() ? o.name : 'My enclosure',
    enclosure: { ...base.enclosure, ...o.enclosure, header: Array.isArray(o.enclosure.header) ? o.enclosure.header : [] },
    rackSpec: { ...blankRackSpec(), ...(o.rackSpec ?? {}) },
    bottle: o.bottle ?? 'BORDEAUX',
    runs: Array.isArray(o.runs) ? o.runs : [],
    walkwayMm: typeof o.walkwayMm === 'number' ? o.walkwayMm : null,
    ...(o.drawing && typeof o.drawing === 'object' ? { drawing: { company: str(o.drawing.company), client: str(o.drawing.client), address: str(o.drawing.address), projectNo: str(o.drawing.projectNo), drawnBy: str(o.drawing.drawnBy), checkedBy: str(o.drawing.checkedBy) } } : {}),
    ...(o.cooling && typeof o.cooling === 'object' ? (() => { const c = o.cooling as Record<string, unknown>; const ok = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined); const ambientC = ok(c.ambientC, 15, 50), targetC = ok(c.targetC, 0, 25); return ambientC !== undefined || targetC !== undefined ? { cooling: { ...(ambientC !== undefined ? { ambientC } : {}), ...(targetC !== undefined ? { targetC } : {}) } } : {}; })() : {}),
    ...(o.finish === 'OAK' || o.finish === 'WALNUT' || o.finish === 'BLACK' ? { finish: o.finish } : {}),
    ...(o.lead && typeof o.lead === 'object' && Number.isInteger(o.lead.id) && o.lead.id > 0 ? { lead: { id: o.lead.id, name: str(o.lead.name) } } : {}),
    ...(o.rackType && typeof o.rackType === 'object' && typeof o.rackType.id === 'string' && o.rackType.id ? { rackType: { id: str(o.rackType.id), name: str(o.rackType.name) || str(o.rackType.id), confirmed: o.rackType.confirmed === true } } : {}),
    ...(Array.isArray(o.estimated) ? { estimated: o.estimated.filter((k): k is EstimateField => (ESTIMATE_FIELDS as readonly string[]).includes(k)) } : {}),
  };
}
