import { advisories, analyseEnclosure, goldenCase02, type Advisory, type Enclosure, type EnclosureAnalysis, type WallSide } from '../enclosure';
import type { BottleProfileId, Issue } from '../engine/types';
import { analyseRacks, type RackLayoutAnalysis, type RackRun } from '../placement';
import { blankRackSpec, type RackSpec } from '../rack';

// What the glass-enclosure screens edit: the enclosure, ONE rack specification shared by every run (blank until real values are entered),
// the runs, and the project's own minimum walkway (blank = not set, so that check does not run).

export const APP_SCHEMA = 1;

export interface RunPlacement { id: string; wall: WallSide; startMm: number; units: number }

export interface AppProject {
  schemaVersion: typeof APP_SCHEMA;
  name: string;
  enclosure: Enclosure;
  rackSpec: RackSpec;
  bottle: BottleProfileId;
  runs: RunPlacement[];
  walkwayMm: number | null;
}

/** The starting project: the Carter Noir sample enclosure as read (unverified), NO rack values, NO walkway minimum. */
export function sampleProject(): AppProject {
  return { schemaVersion: APP_SCHEMA, name: 'Sample enclosure (A101 as read)', enclosure: goldenCase02(), rackSpec: blankRackSpec(), bottle: 'BORDEAUX', runs: [], walkwayMm: null };
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
  };
}
