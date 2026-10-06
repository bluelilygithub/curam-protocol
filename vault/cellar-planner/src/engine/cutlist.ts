import { bayResult, carcassHeightMm, netWidthMm } from './capacity';
import { profileOf } from './defaults';
import type { CabinetBay, ConstructionRules, Part } from './types';

// The cut list (spec-v1.md 9). INDICATIVE: sizes follow the typical construction rules in `ConstructionRules` and must be confirmed by the
// cabinet maker; final measurements are taken on site. Sizes are length x width x thickness of the finished part, in millimetres.

/** One bay's parts. Identical parts are merged with a quantity. */
export function cutListForBay(bay: CabinetBay, r: ConstructionRules): Part[] {
  const T = r.boardMm;
  const carcass = carcassHeightMm(bay.outerHeightMm, r);
  const inner = netWidthMm(bay.widthMm, r);
  const res = bayResult(bay, r);
  const parts: Part[] = [
    { code: 'SIDE', label: 'Side panel', qty: 2, lengthMm: carcass, widthMm: bay.outerDepthMm, thicknessMm: T, material: r.sheetMaterial, edgeBandMm: carcass, notes: [`ROUT_REBATE_${r.rebateMm}MM_BACK`] },
    { code: 'TOP', label: 'Top panel', qty: 1, lengthMm: inner, widthMm: bay.outerDepthMm - r.rebateMm, thicknessMm: T, material: r.sheetMaterial, edgeBandMm: inner, notes: [`ROUT_REBATE_${r.rebateMm}MM_BACK`] },
    { code: 'BOTTOM', label: 'Bottom panel', qty: 1, lengthMm: inner, widthMm: bay.outerDepthMm - r.rebateMm, thicknessMm: T, material: r.sheetMaterial, edgeBandMm: inner, notes: [`ROUT_REBATE_${r.rebateMm}MM_BACK`] },
    { code: 'BACK', label: 'Back panel', qty: 1, lengthMm: carcass - 2 * T, widthMm: inner, thicknessMm: r.backPanelMm, material: `${r.backPanelMm} mm HMR MDF`, edgeBandMm: 0, notes: ['Sits in the rebate. Indicative size.'] },
    { code: 'PLINTH', label: 'Plinth / kick', qty: 1, lengthMm: bay.widthMm, widthMm: r.plinthMm, thicknessMm: T, material: r.sheetMaterial, edgeBandMm: bay.widthMm, notes: [] },
    { code: 'SHADOW_RAIL', label: 'Top shadow rail', qty: 1, lengthMm: bay.widthMm, widthMm: r.topShadowRailMm, thicknessMm: T, material: r.sheetMaterial, edgeBandMm: bay.widthMm, notes: [] },
  ];
  const shelfDepth = bay.outerDepthMm - r.rebateMm - r.frontMarginMm;
  bay.modules.forEach((m, i) => {
    const mr = res.modules[i];
    if (!mr) return;
    // rows are separated by (rows - 1) shelves; a module above the first also owns the divider shelf under it
    const shelves = Math.max(0, mr.rows - 1) + (i > 0 ? 1 : 0);
    if (!shelves) return;
    const notes: string[] = [];
    if (m.storageStyle === 'SCALLOPED_CRADLE') notes.push(`CNC_ROUT_SCALLOP_${profileOf(m.bottleProfile).slotPitchMm}MM`, `${mr.slotsPerRow} slots per shelf`);
    if (m.storageStyle === 'LABEL_FORWARD') notes.push(`INCLINED_${r.displayAngleDeg}DEG_DISPLAY_SHELF`, `${mr.slotsPerRow} slots per tier`);
    parts.push({ code: 'SHELF', label: m.storageStyle === 'LABEL_FORWARD' ? 'Display shelf' : 'Scalloped shelf', qty: shelves, lengthMm: inner, widthMm: shelfDepth, thicknessMm: T, material: r.sheetMaterial, edgeBandMm: inner, notes });
  });
  return parts;
}

const keyOf = (p: Part): string => [p.code, p.lengthMm, p.widthMm, p.thicknessMm, p.material, p.edgeBandMm, p.notes.join('|')].join('~');

/** Add up identical parts (same code, size, material and notes). */
export function mergeParts(parts: Part[]): Part[] {
  const by = new Map<string, Part>();
  for (const p of parts) {
    const k = keyOf(p);
    const have = by.get(k);
    if (have) have.qty += p.qty; else by.set(k, { ...p, notes: [...p.notes] });
  }
  return [...by.values()];
}

export interface PartTotals { pieces: number; sheetAreaM2: number; edgeBandM: number }

export function partTotals(parts: Part[]): PartTotals {
  let pieces = 0, area = 0, edge = 0;
  for (const p of parts) { pieces += p.qty; area += (p.qty * p.lengthMm * p.widthMm) / 1e6; edge += (p.qty * p.edgeBandMm) / 1000; }
  return { pieces, sheetAreaM2: area, edgeBandM: edge };
}

/** A stable placeholder code for a module until packaged products exist, such as CUSTOM-PORT-800-1618. */
export function placeholderCode(style: 'SCALLOPED_CRADLE' | 'LABEL_FORWARD' | 'CASE_DRAWER', widthMm: number, heightMm: number): string {
  const tag = style === 'SCALLOPED_CRADLE' ? 'PORT' : style === 'LABEL_FORWARD' ? 'DISP' : 'CASE';
  return `CUSTOM-${tag}-${widthMm}-${Math.round(heightMm)}`;
}
