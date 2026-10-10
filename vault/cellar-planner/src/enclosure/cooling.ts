import type { CoolingSettings } from '../lite/config';
import { wallLengthMm } from './enclosure';
import type { Enclosure, HeaderComponent, WallSide } from './types';

// An INDICATIVE cooling estimate for the enclosure: how much heat leaks in, and so roughly how much cooling it needs. It is the standard steady-state
// method (heat through each surface = U x area x temperature difference, plus internal gains and a safety margin) with every assumption in the open:
// insulation conductivity, glass U-value, an uninsulated floor, internal gains, margin and the two temperatures come from Settings (and the two
// temperatures can be set per design). It is a guide for choosing a conditioner, never a design: the advisory notes still say HVAC sign-off is needed.
// Pure, so every line is tested and the technician help can show the working.

export type CoolingAssumptions = CoolingSettings;
export const DEFAULT_COOLING: CoolingAssumptions = { panelConductivity: 0.025, glassU: 1.4, floorU: 1, internalGainsW: 100, marginPct: 20, targetC: 14, ambientC: 35 };

export interface CoolingLine { id: string; label: string; formula: string; working: string; watts: number }
export type CoolingResult =
  | {
    status: 'OK';
    deltaC: number;
    lines: CoolingLine[];
    /** Heat through the walls, door, ceiling and floor. */
    envelopeW: number;
    gainsW: number;
    subtotalW: number;
    marginW: number;
    /** What the cooling must deliver, including the margin. */
    totalW: number;
    notes: string[];
  }
  | { status: 'NOT_SET'; reason: string };

const m2 = (mmA: number, mmB: number): number => (mmA * mmB) / 1e6;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const sideName = (s: WallSide): string => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * The cooling load for this enclosure. Areas are to the OUTER faces (the heat-loss surfaces). U = conductivity / thickness for an insulated wall,
 * ceiling or floor, the glass U-value for glass, and the floor U-value when no floor build-up is entered. A wall, the ceiling or a door with no
 * thickness entered has no insulation to work from, so the estimate says "not set" rather than guess.
 */
export function coolingLoad(e: Enclosure, a: CoolingAssumptions): CoolingResult {
  const dT = a.ambientC - a.targetC;
  if (!(dT > 0)) return { status: 'NOT_SET', reason: `The target temperature (${a.targetC} °C) must be below the outside design temperature (${a.ambientC} °C) for the cellar to need cooling.` };
  const lines: CoolingLine[] = [];
  const notes: string[] = [];
  const add = (id: string, label: string, u: number, area: number, what: string): void => {
    lines.push({ id, label, formula: 'U × area × temperature difference', working: `${r1(u * 1000) / 1000} × ${r1(area * 100) / 100} m² × ${dT} K${what ? ` (${what})` : ''}`, watts: u * area * dT });
  };
  const k = a.panelConductivity;

  for (const side of ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const) {
    const w = e.walls[side];
    const doorHere = e.door.wall === side;
    const doorArea = doorHere ? m2(e.door.widthMm, Math.min(e.door.heightMm, e.heightMm)) : 0;
    const full = m2(wallLengthMm(e, side), e.heightMm);
    const wallArea = Math.max(0, full - doorArea);
    let u: number, what: string;
    if (w.kind === 'GLASS') { u = a.glassU; what = 'glass'; }
    else {
      if (!(w.buildUpMm > 0)) return { status: 'NOT_SET', reason: `The ${sideName(side).toLowerCase()} wall has no build-up (thickness) entered, so its insulation is not known.` };
      u = k / (w.buildUpMm / 1000); what = `${w.buildUpMm} mm insulation`;
    }
    add(`wall-${side.toLowerCase()}`, `${sideName(side)} wall${doorHere ? ' (less the door)' : ''}`, u, wallArea, what);
    if (doorHere) {
      let du: number, dwhat: string;
      if (e.door.glazed || w.kind === 'GLASS') { du = a.glassU; dwhat = 'glazed'; }
      else { if (!(w.buildUpMm > 0)) return { status: 'NOT_SET', reason: 'The door wall has no build-up entered, so the door\'s insulation is not known.' }; du = k / (w.buildUpMm / 1000); dwhat = `${w.buildUpMm} mm, as its wall`; }
      add('door', 'Door', du, doorArea, dwhat);
    }
  }
  const roof = m2(e.outerWidthMm, e.outerDepthMm);
  if (!(e.ceilingBuildUpMm > 0)) return { status: 'NOT_SET', reason: 'The ceiling has no build-up (thickness) entered, so its insulation is not known.' };
  add('ceiling', 'Ceiling', k / (e.ceilingBuildUpMm / 1000), roof, `${e.ceilingBuildUpMm} mm insulation`);
  if (e.floorBuildUpMm > 0) add('floor', 'Floor', k / (e.floorBuildUpMm / 1000), roof, `${e.floorBuildUpMm} mm insulation`);
  else { add('floor', 'Floor', a.floorU, roof, 'no floor build-up: the uninsulated floor U-value'); notes.push('No floor build-up is entered, so the floor is treated as an uninsulated slab. Enter its build-up if it is insulated.'); }

  const envelopeW = lines.reduce((n, l) => n + l.watts, 0);
  const subtotalW = envelopeW + a.internalGainsW;
  const marginW = subtotalW * (a.marginPct / 100);
  notes.push('Internal gains cover lights, people and new stock. The margin covers door openings and uncertainty.', 'This is a guide for choosing a conditioner. It always needs mechanical engineer / HVAC sign-off.');
  return { status: 'OK', deltaC: dT, lines, envelopeW, gainsW: a.internalGainsW, subtotalW, marginW, totalW: subtotalW + marginW, notes };
}

/** The conditioners in the header that have a rated capacity, and whether every conditioner has one. */
export function conditionerCapacity(header: HeaderComponent[]): { totalW: number; count: number; unrated: number } {
  const cond = header.filter((c) => c.kind === 'CONDITIONER');
  const rated = cond.filter((c) => typeof c.capacityW === 'number' && c.capacityW > 0);
  return { totalW: rated.reduce((n, c) => n + (c.capacityW as number), 0), count: cond.length, unrated: cond.length - rated.length };
}

export type CoolingFit =
  | { status: 'NO_CONDITIONER' }
  | { status: 'UNRATED'; unrated: number }
  | { status: 'COVERED'; capacityW: number; spareW: number; sparePct: number }
  | { status: 'SHORT'; capacityW: number; shortW: number };

/** Does the header's conditioning cover the load? "Unrated" until every conditioner has a capacity entered: a missing figure is never counted as zero. */
export function coolingFit(header: HeaderComponent[], load: Extract<CoolingResult, { status: 'OK' }>): CoolingFit {
  const c = conditionerCapacity(header);
  if (c.count === 0) return { status: 'NO_CONDITIONER' };
  if (c.unrated > 0) return { status: 'UNRATED', unrated: c.unrated };
  return c.totalW >= load.totalW
    ? { status: 'COVERED', capacityW: c.totalW, spareW: c.totalW - load.totalW, sparePct: ((c.totalW - load.totalW) / load.totalW) * 100 }
    : { status: 'SHORT', capacityW: c.totalW, shortW: load.totalW - c.totalW };
}

/** The assumptions in force for a design: the Settings values (or the built-in defaults) with the design's own temperatures on top. */
export function effectiveCooling(base: CoolingAssumptions | null | undefined, own?: { ambientC?: number; targetC?: number }): CoolingAssumptions {
  const b = base ?? DEFAULT_COOLING;
  return { ...b, ...(own?.ambientC !== undefined ? { ambientC: own.ambientC } : {}), ...(own?.targetC !== undefined ? { targetC: own.targetC } : {}) };
}
