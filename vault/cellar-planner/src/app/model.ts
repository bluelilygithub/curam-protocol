import { advisories, analyseEnclosure, goldenCase02, type Advisory, type Enclosure, type EnclosureAnalysis, type WallSide } from '../enclosure';
import type { BottleProfileId, Issue } from '../engine/types';
import { analyseRacks, fillWall, type RackLayoutAnalysis, type RackRun } from '../placement';
import { blankRackSpec, type RackSpec } from '../rack';

// What the glass-enclosure screens edit: the enclosure, ONE rack specification shared by every run (blank until real values are entered),
// the runs, and the project's own minimum walkway (blank = not set, so that check does not run).

export const APP_SCHEMA = 1;

export interface RunPlacement { id: string; wall: WallSide; startMm: number; units: number }

/** The rack specification fields a test case can fill with guesses. Each loses its "estimated" marker the moment the person edits it. */
export const ESTIMATE_FIELDS = ['unitWidthMm', 'unitDepthMm', 'unitHeightMm', 'rowPitchMm', 'bottlesPerRow', 'orientation', 'postsPerUnit'] as const;
export type EstimateField = (typeof ESTIMATE_FIELDS)[number];

export interface AppProject {
  schemaVersion: typeof APP_SCHEMA;
  name: string;
  enclosure: Enclosure;
  rackSpec: RackSpec;
  bottle: BottleProfileId;
  runs: RunPlacement[];
  walkwayMm: number | null;
  /** Rack fields whose values are BEST GUESSES (a test case), not supplier values. Empty or absent for a real design. */
  estimated?: EstimateField[];
}

/** The starting project: the Carter Noir sample enclosure as read (unverified), NO rack values, NO walkway minimum. */
export function sampleProject(): AppProject {
  return { schemaVersion: APP_SCHEMA, name: 'Sample enclosure (A101 as read)', enclosure: goldenCase02(), rackSpec: blankRackSpec(), bottle: 'BORDEAUX', runs: [], walkwayMm: null };
}

/**
 * A ready-made test case: the sample enclosure with racks on every wall, filled with BEST-GUESS rack values so there are bottles to count. The
 * guesses are invented, not a supplier's: a 600 x 350 mm unit, 2000 mm tall, a 100 mm row pitch (the spacing on the sample drawing), 7 neck-out
 * bottles a row (600 mm at the 85 mm Bordeaux slot pitch), 2 posts. Every one is marked "estimated" until the person overwrites it. The minimum
 * walkway stays blank: it is the business's number, not a guess.
 */
export function testCaseProject(): AppProject {
  const base = sampleProject();
  const rackSpec: RackSpec = { unitWidthMm: 600, unitDepthMm: 350, unitHeightMm: 2000, rowPitchMm: 100, bottlesPerRow: 7, orientation: 'NECK_OUT', postsPerUnit: 2, rowsPerUnit: null };
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
    ...(Array.isArray(o.estimated) ? { estimated: o.estimated.filter((k): k is EstimateField => (ESTIMATE_FIELDS as readonly string[]).includes(k)) } : {}),
  };
}
