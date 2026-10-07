import { profileOf } from './defaults';
import type { BayModule, BayResult, BottleProfile, CabinetBay, ConstructionRules, ModuleResult, RowResult } from './types';

// ---------------------------------------------------------------- the stack (spec-v1.md 5.1)

/** Everything between the plinth and the shadow rail is carcass: sides run this tall. */
export const carcassHeightMm = (outerHeightMm: number, r: ConstructionRules): number => outerHeightMm - r.plinthMm - r.topShadowRailMm;

/** Height available to modules: the carcass minus its own bottom and top panels. */
export const stackZoneMm = (outerHeightMm: number, r: ConstructionRules): number => carcassHeightMm(outerHeightMm, r) - 2 * r.boardMm;

/** Inside depth for bottles: outer depth less the front setback and the back panel's rebate (back panel plus the void behind it). */
export const internalDepthMm = (outerDepthMm: number, r: ConstructionRules): number => outerDepthMm - r.frontMarginMm - r.rebateMm;

/** Inside width between the two side panels. */
export const netWidthMm = (widthMm: number, r: ConstructionRules): number => widthMm - 2 * r.boardMm;

/**
 * Module heights bottom to top. The upper modules' heights are given; the base module takes the rest of the stack, so the sum is always the
 * stack zone. `baseMm` can be zero or negative when the upper modules do not fit (a check reports that).
 */
export function moduleHeightsMm(bay: CabinetBay, r: ConstructionRules): number[] {
  const upper = bay.modules.slice(1).map((m) => m.heightMm ?? 0);
  const base = stackZoneMm(bay.outerHeightMm, r) - upper.reduce((a, b) => a + b, 0);
  return bay.modules.length ? [base, ...upper] : [];
}

/** The space bottles can use: a module above the first owns a divider shelf at its bottom, the first sits on the cabinet's bottom panel. */
export const netHeightMm = (heightMm: number, index: number, r: ConstructionRules): number => (index === 0 ? heightMm : heightMm - r.boardMm);

// ---------------------------------------------------------------- scalloped rows (5.2)

/**
 * N rows fit when N*clear + (N-1)*shelf <= net, so N = floor((net + shelf) / (minClear + shelf)). The spare height is shared out evenly, so
 * every row is the same and none is left "unallocated".
 */
export function scallopedRows(netMm: number, profile: BottleProfile, r: ConstructionRules): RowResult {
  const rows = netMm > 0 ? Math.floor((netMm + r.boardMm) / (profile.minClearMm + r.boardMm)) : 0;
  if (rows < 1) return { rows: 0, clearMm: 0, absorbedMm: 0 };
  const clearMm = (netMm - (rows - 1) * r.boardMm) / rows;
  return { rows, clearMm, absorbedMm: clearMm - profile.minClearMm };
}

/** Bottles side by side across one row. */
export const slotsPerRow = (widthMm: number, pitchMm: number, r: ConstructionRules): number => Math.max(0, Math.floor(netWidthMm(widthMm, r) / pitchMm));

// ---------------------------------------------------------------- label-forward displays (5.3)

/** Height of a bottle lying along the cabinet's depth at the display angle: L sin(a) + D cos(a). */
export function displayEnvelopeMm(profile: BottleProfile, r: ConstructionRules): number {
  const a = (r.displayAngleDeg * Math.PI) / 180;
  return profile.lengthMm * Math.sin(a) + profile.diameterMm * Math.cos(a);
}

/** Depth an inclined bottle takes, with the front lip: L cos(a) + D sin(a) + lip. */
export function displayDepthNeededMm(profile: BottleProfile, r: ConstructionRules): number {
  const a = (r.displayAngleDeg * Math.PI) / 180;
  return profile.lengthMm * Math.cos(a) + profile.diameterMm * Math.sin(a) + r.displayLipMm;
}

/** Opening one display tier needs: the envelope plus room for a hand. */
export const displayClearMm = (profile: BottleProfile, r: ConstructionRules): number => displayEnvelopeMm(profile, r) + r.displayHandClearanceMm;

/** Tiers in a display module, found the same way as scalloped rows (the tiers are separated by shelves). */
export function displayTiers(netMm: number, profile: BottleProfile, r: ConstructionRules): RowResult {
  const need = displayClearMm(profile, r);
  const rows = netMm > 0 ? Math.floor((netMm + r.boardMm) / (need + r.boardMm)) : 0;
  if (rows < 1) return { rows: 0, clearMm: 0, absorbedMm: 0 };
  const clearMm = (netMm - (rows - 1) * r.boardMm) / rows;
  return { rows, clearMm, absorbedMm: clearMm - need };
}

// ---------------------------------------------------------------- module and bay

export function moduleResult(m: BayModule, heightMm: number, index: number, widthMm: number, r: ConstructionRules): ModuleResult {
  const profile = profileOf(m.bottleProfile);
  const net = netHeightMm(heightMm, index, r);
  let rows = { rows: 0, clearMm: 0, absorbedMm: 0 };
  if (m.storageStyle === 'SCALLOPED_CRADLE') rows = scallopedRows(net, profile, r);
  else if (m.storageStyle === 'LABEL_FORWARD') rows = displayTiers(net, profile, r);
  // CASE_DRAWER: not modelled in V1, holds no counted bottles
  const slots = m.storageStyle === 'CASE_DRAWER' ? 0 : slotsPerRow(widthMm, profile.slotPitchMm, r);
  return { moduleId: m.id, heightMm, netHeightMm: net, rows: rows.rows, slotsPerRow: slots, capacity: rows.rows * slots, clearMm: rows.clearMm, absorbedMm: rows.absorbedMm };
}

export function bayResult(bay: CabinetBay, r: ConstructionRules): BayResult {
  const heights = moduleHeightsMm(bay, r);
  const modules = bay.modules.map((m, i) => moduleResult(m, heights[i], i, bay.widthMm, r));
  return {
    bayId: bay.id,
    stackZoneMm: stackZoneMm(bay.outerHeightMm, r),
    internalDepthMm: internalDepthMm(bay.outerDepthMm, r),
    netWidthMm: netWidthMm(bay.widthMm, r),
    modules,
    capacity: modules.reduce((n, m) => n + m.capacity, 0),
  };
}

/** The bay width that wastes no sideways space for a bottle profile: the sides plus a whole number of slots. */
export const targetWidthMm = (slots: number, profile: BottleProfile, r: ConstructionRules): number => 2 * r.boardMm + slots * profile.slotPitchMm;
