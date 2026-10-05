// The plant schedule: what is planted in the garden, one row per kind of plant, with quantities, mature sizes, spacing, needs, cautions, where
// it is and what we know about it. The same rows feed the on-screen table and the CSV, so they cannot disagree. Pure.
//
// Every row says the plant data is a draft, unverified (spec: anything that uses plant data must), and the weed column says "unknown" where
// the weed list was never checked, never "not a weed".
import { pointInPolygonInclusive } from '@planner-core/engine/geometry';
import { csvText, slug } from '@planner-core/export/csv';
import type { Vec2 } from '@planner-core/types';
import { recommendedSpacing } from '../domain/edit';
import { sampleShape } from '../domain/shapes';
import type { GardenProject, PlantInstance } from '../domain/types';
import { MONTHS } from '../plants/growth';
import { plantById } from '../plants/plants';
import type { PlantRecord, PlantType } from '../plants/types';
import { weedStatus } from '../plants/weeds';

export const DRAFT_STATUS = 'Draft, unverified';
export const DRAFT_NOTE = 'Plant data in this schedule is a draft and has not been verified. Check sizes, frost and weed information with a local nursery or your state weed list before buying.';
export const WEED_NOTE = 'Weed status is only known where it was checked against a state weed list; "unknown" is not the same as safe.';

export interface ScheduleRow {
  ref: string;
  plantId: string;
  common: string;
  botanical: string;
  qty: number;
  type: string;
  origin: string;
  height: [number, number];
  spread: [number, number];
  spacing: number;
  sun: string;
  water: string;
  frost: string;
  flowers: string;
  colours: string;
  foliage: string;
  cautions: string;
  weed: string;
  where: string;
  notes: string;
  status: string;
}
export interface PlantSchedule {
  rows: ScheduleRow[];
  total: number;
  species: number;
  /** Plants in the plan whose record is no longer in the library (they are listed, not dropped). */
  missing: number;
}

const TYPE_ORDER: readonly PlantType[] = ['tree', 'palm', 'shrub', 'climber', 'perennial', 'grass', 'groundcover', 'succulent', 'fern', 'edible', 'annual', 'aquatic'];
const label = (s: string): string => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** [9,10,11,12] -> "Sep-Dec"; [11,12,1,2] -> "Nov-Feb" (runs wrap over the new year); separate runs are joined with commas. */
export function monthRanges(months: readonly number[]): string {
  const set = new Set(months.filter((m) => m >= 1 && m <= 12));
  if (set.size === 0) return '';
  if (set.size === 12) return 'All year';
  // start the walk just after a gap, so a run that wraps the year stays in one piece
  let start = 1;
  for (let m = 1; m <= 12; m += 1) if (!set.has(m) && set.has((m % 12) + 1)) { start = (m % 12) + 1; break; }
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < 12; i += 1) {
    const m = ((start - 1 + i) % 12) + 1;
    if (!set.has(m)) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === (((m - 2 + 12) % 12) + 1)) last[1] = m; else runs.push([m, m]);
  }
  return runs.map(([a, b]) => (a === b ? MONTHS[a - 1] : `${MONTHS[a - 1]}-${MONTHS[b - 1]}`)).join(', ');
}

/** What the garden calls the place a point is in: a bed, a lawn, a zone, open ground, or outside the boundary. */
export function placeOf(p: GardenProject, at: Vec2): string {
  for (const b of p.beds) if (pointInPolygonInclusive(at, sampleShape(b.shape))) return b.name;
  for (const l of p.lawns) if (pointInPolygonInclusive(at, sampleShape(l.shape))) return l.name;
  for (const z of p.zones) if (pointInPolygonInclusive(at, sampleShape(z.shape))) return z.name;
  if (p.boundary && !pointInPolygonInclusive(at, p.boundary.vertices.map((v) => v.position))) return 'Outside the boundary';
  return 'Open ground';
}

const weedText = (rec: PlantRecord, state: GardenProject['location']['state']): string => {
  switch (weedStatus(rec, state)) {
    case 'listed': return `Listed as a weed in ${state}`;
    case 'not_listed': return `Not listed in ${state} (checked)`;
    default: return `Unknown in ${state} (not checked)`;
  }
};
const cautionsText = (rec: PlantRecord): string => rec.cautions.map((c) => ({ toxic_pets: 'Toxic to pets', toxic_people: 'Toxic to people', spiky: 'Spiky', invasive_roots: 'Invasive roots' })[c]).join('; ');
const r1 = (n: number): number => Math.round(n * 10) / 10;

export function buildPlantSchedule(p: GardenProject): PlantSchedule {
  const groups = new Map<string, PlantInstance[]>();
  for (const inst of p.plants) groups.set(inst.plantId, [...(groups.get(inst.plantId) ?? []), inst]);
  const state = p.location.state;
  const rows: Omit<ScheduleRow, 'ref'>[] = [];
  let missing = 0;
  for (const [plantId, insts] of groups) {
    const rec = plantById(plantId);
    const where = new Map<string, number>();
    for (const i of insts) { const w = placeOf(p, i.position); where.set(w, (where.get(w) ?? 0) + 1); }
    const whereText = [...where.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => (c > 1 || where.size > 1 ? `${n} (${c})` : n)).join(', ');
    const notes = [...new Set(insts.map((i) => i.note?.trim()).filter((n): n is string => !!n))].join('; ');
    if (!rec) {
      missing += insts.length;
      rows.push({ plantId, common: plantId, botanical: '', qty: insts.length, type: '', origin: '', height: [0, 0], spread: [0, 0], spacing: 0, sun: '', water: '', frost: '', flowers: '', colours: '', foliage: '', cautions: '', weed: '', where: whereText, notes: notes ? `${notes}; no longer in the plant library` : 'No longer in the plant library', status: DRAFT_STATUS });
      continue;
    }
    rows.push({
      plantId, common: rec.common[0] ?? rec.botanical, botanical: rec.cultivar ? `${rec.botanical} '${rec.cultivar}'` : rec.botanical,
      qty: insts.length, type: label(rec.type), origin: rec.native ? `Australian native${rec.origin.length ? ` (${rec.origin.join(', ')})` : ''}` : 'Exotic',
      height: rec.height, spread: rec.spread, spacing: r1(recommendedSpacing(plantId)),
      sun: rec.sun.map(label).join(', '), water: label(rec.water) + (rec.droughtTolerant ? ', drought tolerant' : ''),
      frost: rec.frost === 'none' ? 'Frost tender' : `Up to ${rec.frost} frost`,
      flowers: monthRanges(rec.flowerMonths), colours: rec.flowerColours.join(', '), foliage: label(rec.foliage),
      cautions: cautionsText(rec), weed: weedText(rec, state), where: whereText, notes, status: DRAFT_STATUS,
    });
  }
  const order = (type: string): number => { const i = TYPE_ORDER.findIndex((t) => label(t) === type); return i === -1 ? 99 : i; };
  rows.sort((a, b) => order(a.type) - order(b.type) || a.common.localeCompare(b.common) || a.botanical.localeCompare(b.botanical));
  const numbered = rows.map((r, i) => ({ ...r, ref: `P${i + 1}` }));
  return { rows: numbered, total: numbered.reduce((s, r) => s + r.qty, 0), species: numbered.length, missing };
}

export const CSV_COLUMNS = ['No.', 'Common name', 'Botanical name', 'Qty', 'Type', 'Origin', 'Height min (m)', 'Height max (m)', 'Spread min (m)', 'Spread max (m)', 'Spacing (m)', 'Sun', 'Water', 'Frost', 'Flowers', 'Flower colours', 'Foliage', 'Cautions', 'Weed status', 'Where planted', 'Notes', 'Data status'] as const;

/** The schedule as CSV text: a header, one row per kind of plant, a total, and the draft and weed notes. Add the byte-order mark with `csvBlobParts`. */
export function scheduleCsv(s: PlantSchedule): string {
  const blank: Array<string | number> = Array.from({ length: CSV_COLUMNS.length }, () => '');
  const row = (r: ScheduleRow): Array<string | number> => [r.ref, r.common, r.botanical, r.qty, r.type, r.origin, r.height[0], r.height[1], r.spread[0], r.spread[1], r.spacing, r.sun, r.water, r.frost, r.flowers, r.colours, r.foliage, r.cautions, r.weed, r.where, r.notes, r.status];
  const total = [...blank]; total[1] = 'Total plants'; total[3] = s.total; total[4] = `${s.species} kind${s.species === 1 ? '' : 's'}`; total[21] = DRAFT_STATUS;
  const note = [...blank]; note[1] = 'Note'; note[20] = `${DRAFT_NOTE} ${WEED_NOTE}`; note[21] = DRAFT_STATUS;
  return csvText([[...CSV_COLUMNS], ...s.rows.map(row), total, note]);
}

export const scheduleFileName = (garden: string): string => `${slug(garden) || 'garden'}-plant-schedule.csv`;
