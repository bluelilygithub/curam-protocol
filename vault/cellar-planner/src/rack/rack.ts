import { displayDepthNeededMm } from '../engine/capacity';
import { DEFAULT_RULES, profileOf } from '../engine/defaults';
import type { BottleProfileId, ConstructionRules, Issue } from '../engine/types';

// Metal racking (spec-v1.md section 14). There is NO supplier sheet yet, so every field starts blank and nothing is assumed: capacity is
// "not set" until the owner (or their fabricator) enters real values. A blank is never counted as zero bottles, and a rack with missing
// values is never quoted.

export type RackOrientation = 'NECK_OUT' | 'LABEL_FORWARD';

/** One rack unit's specification, as the fabricator would give it. `null` means not entered yet. */
export interface RackSpec {
  unitWidthMm: number | null;
  unitDepthMm: number | null;
  unitHeightMm: number | null;
  /** Vertical distance from one row of bottles to the next. */
  rowPitchMm: number | null;
  /**
   * Bottles side by side in one row, neck-out. If left blank it is CALCULATED (unit width / the bottle's pitch); a typed value is the
   * fabricator's real figure and wins.
   */
  bottlesPerRow: number | null;
  /**
   * Bottles in a row when they are label-forward. On a metal rack that may mean the bottle lies side-on and takes about its own length of
   * width, so the neck-out figure must NOT carry over: this is never calculated and stays "not set" until the fabricator says.
   */
  bottlesPerRowLabelForward?: number | null;
  orientation: RackOrientation | null;
  /** Posts in one unit (for the parts list; does not change capacity). */
  postsPerUnit: number | null;
  /** If the fabricator states the number of rows, it is used as given instead of height divided by pitch. */
  rowsPerUnit?: number | null;
}

/** A blank spec: the state the table starts in. */
export const blankRackSpec = (): RackSpec => ({ unitWidthMm: null, unitDepthMm: null, unitHeightMm: null, rowPitchMm: null, bottlesPerRow: null, bottlesPerRowLabelForward: null, orientation: null, postsPerUnit: null, rowsPerUnit: null });

const LABELS: Record<string, string> = {
  unitWidthMm: 'unit width', unitDepthMm: 'unit depth', unitHeightMm: 'unit height', rowPitchMm: 'row pitch', bottlesPerRow: 'bottles per row',
  bottlesPerRowLabelForward: 'bottles per row (label-forward)', orientation: 'bottle orientation', postsPerUnit: 'posts per unit',
};

/**
 * Bottles in one row and where the number came from. A typed value is the fabricator's and wins. Otherwise, neck-out only, it is calculated:
 * floor(unit width / the bottle's slot pitch), an ESTIMATE (the real pin spacing comes from the fabricator). Label-forward is never calculated.
 */
export function effectiveBottlesPerRow(s: RackSpec, bottle?: BottleProfileId): { value: number; source: 'typed' | 'calculated' } | null {
  if (s.orientation === 'LABEL_FORWARD') return s.bottlesPerRowLabelForward !== null && s.bottlesPerRowLabelForward !== undefined ? { value: s.bottlesPerRowLabelForward, source: 'typed' } : null;
  if (s.bottlesPerRow !== null && s.bottlesPerRow !== undefined) return { value: s.bottlesPerRow, source: 'typed' };
  if (bottle && s.unitWidthMm !== null && s.orientation === 'NECK_OUT') {
    const n = Math.floor(s.unitWidthMm / profileOf(bottle).slotPitchMm);
    return n > 0 ? { value: n, source: 'calculated' } : null;
  }
  return null;
}

/** Which required fields are blank. The rows can come from `rowsPerUnit` instead of height and pitch, so those two are only required without it. */
export function missingFields(s: RackSpec, bottle?: BottleProfileId): string[] {
  const need = ['unitWidthMm', 'unitDepthMm', 'orientation', 'postsPerUnit'] as const;
  const out: string[] = need.filter((k) => s[k] === null || s[k] === undefined).map((k) => LABELS[k]);
  if (!effectiveBottlesPerRow(s, bottle)) out.push(LABELS[s.orientation === 'LABEL_FORWARD' ? 'bottlesPerRowLabelForward' : 'bottlesPerRow']);
  if (s.rowsPerUnit === null || s.rowsPerUnit === undefined) {
    if (s.unitHeightMm === null) out.push(LABELS.unitHeightMm);
    if (s.rowPitchMm === null) out.push(LABELS.rowPitchMm);
  }
  return out;
}

export type RackCapacity =
  | { status: 'NOT_SET'; missing: string[] }
  | { status: 'OK'; rowsPerUnit: number; bottlesPerRow: number; bottlesPerRowSource: 'typed' | 'calculated'; units: number; capacity: number };

/**
 * Capacity = rows x bottles per row x units. Rows are `rowsPerUnit` if given, else floor(height / pitch) (the first row's offset from the
 * floor of the unit is not modelled: indicative). Returns "not set" with the missing fields, never 0, when the spec is incomplete.
 */
export function rackCapacity(s: RackSpec, units: number, bottle?: BottleProfileId): RackCapacity {
  const missing = missingFields(s, bottle);
  if (missing.length) return { status: 'NOT_SET', missing };
  const rows = s.rowsPerUnit ?? Math.floor((s.unitHeightMm as number) / (s.rowPitchMm as number));
  const per = effectiveBottlesPerRow(s, bottle) as { value: number; source: 'typed' | 'calculated' };
  return { status: 'OK', rowsPerUnit: rows, bottlesPerRow: per.value, bottlesPerRowSource: per.source, units, capacity: rows * per.value * units };
}

/** Depth a bottle needs inside the unit: neck-out is its length plus the clearance, label-forward the inclined footprint with its lip. */
export function rackDepthNeededMm(orientation: RackOrientation, bottle: BottleProfileId, rules: ConstructionRules = DEFAULT_RULES): number {
  const p = profileOf(bottle);
  return orientation === 'LABEL_FORWARD' ? displayDepthNeededMm(p, rules) : p.lengthMm + rules.depthClearanceMm;
}

/** Checks on a rack spec. An incomplete spec is reported as one error that names the missing fields; the depth check needs only what is entered. */
export function checkRackSpec(s: RackSpec, bottle: BottleProfileId, rules: ConstructionRules = DEFAULT_RULES): Issue[] {
  const out: Issue[] = [];
  const missing = missingFields(s, bottle);
  if (missing.length) {
    out.push({ code: 'RACK_SPEC_MISSING', severity: 'error', message: `The rack specification is incomplete (missing: ${missing.join(', ')}), so its capacity is not set.`, fix: "Enter your supplier's or fabricator's values. Until then this rack cannot be counted or quoted." });
  }
  if (s.orientation && s.unitDepthMm !== null) {
    const need = rackDepthNeededMm(s.orientation, bottle, rules);
    if (s.unitDepthMm < need) {
      out.push({ code: 'RACK_DEPTH_TOO_SHALLOW', severity: 'error', message: `A ${s.unitDepthMm} mm deep unit cannot hold ${profileOf(bottle).label} bottles ${s.orientation === 'NECK_OUT' ? 'neck-out' : 'label-forward'} (${Math.round(need)} mm needed).`, fix: `Use a unit at least ${Math.ceil(need)} mm deep.` });
    }
  }
  if (s.rowPitchMm !== null && s.rowPitchMm < profileOf(bottle).diameterMm) {
    out.push({ code: 'RACK_PITCH_TOO_SMALL', severity: 'error', message: `A ${s.rowPitchMm} mm row pitch is less than a ${profileOf(bottle).diameterMm} mm bottle.`, fix: `Use a pitch of at least ${profileOf(bottle).diameterMm} mm.` });
  }
  // a typed bottles-per-row that cannot fit across the unit: more bottles than the unit is wide, at this bottle's diameter
  const typed = s.orientation === 'LABEL_FORWARD' ? null : s.bottlesPerRow;
  if (typed !== null && s.unitWidthMm !== null && typed * profileOf(bottle).diameterMm > s.unitWidthMm) {
    out.push({ code: 'RACK_ROW_TOO_WIDE', severity: 'error', message: `${typed} ${profileOf(bottle).label} bottles side by side need at least ${typed * profileOf(bottle).diameterMm} mm, but the unit is ${s.unitWidthMm} mm wide.`, fix: `Use at most ${Math.floor(s.unitWidthMm / profileOf(bottle).diameterMm)} bottles per row, or a wider unit.` });
  }
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'number' && !(v > 0)) out.push({ code: 'RACK_VALUE_INVALID', severity: 'error', message: `${LABELS[k] ?? k} must be more than zero.`, where: k });
  }
  return out;
}
