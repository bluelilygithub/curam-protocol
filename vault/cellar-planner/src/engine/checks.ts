import { bayResult, displayDepthNeededMm, displayClearMm, internalDepthMm, moduleHeightsMm, netWidthMm, stackZoneMm, targetWidthMm } from './capacity';
import { profileOf } from './defaults';
import { adjacentWall, runExtent, wallLengthMm } from './layout';
import type { BayModule, CabinetBay, ConstructionRules, Issue, Wall } from './types';

// The Checks Panel's rules (spec-v1.md 8). Each issue says what is wrong, and where there is a clear fix, what to do about it.

const ceil10 = (n: number): number => Math.ceil(n / 10) * 10;

/** Internal depth a module needs: a bottle's length plus the clearance, or an inclined display's footprint with its lip. */
export function depthNeededMm(m: BayModule, r: ConstructionRules): number {
  const p = profileOf(m.bottleProfile);
  return m.storageStyle === 'LABEL_FORWARD' ? displayDepthNeededMm(p, r) : p.lengthMm + r.depthClearanceMm;
}

/** The smallest outer depth (to the next 10 mm) that gives `neededInternalMm` inside. */
export const minOuterDepthMm = (neededInternalMm: number, r: ConstructionRules): number => ceil10(neededInternalMm + r.frontMarginMm + r.rebateMm);

export function checkBay(bay: CabinetBay, roomHeightMm: number, r: ConstructionRules): Issue[] {
  const out: Issue[] = [];
  const at = bay.id;
  const res = bayResult(bay, r);

  if (bay.modules.length === 0) out.push({ code: 'BAY_EMPTY', severity: 'warning', message: 'This bay has no modules.', where: at });
  if (bay.modules[0]?.heightMm !== undefined) out.push({ code: 'BASE_HEIGHT_STORED', severity: 'error', message: 'The bottom module takes the rest of the stack, so its height must not be set.', where: at });
  bay.modules.forEach((m, i) => { if (i > 0 && (m.heightMm === undefined || m.heightMm <= 0)) out.push({ code: 'UPPER_HEIGHT_MISSING', severity: 'error', message: 'Every module above the bottom one needs a height.', where: m.id }); });

  if (bay.outerHeightMm > roomHeightMm) out.push({ code: 'BAY_TOO_TALL', severity: 'error', message: `The bay is ${bay.outerHeightMm} mm tall in a ${roomHeightMm} mm room.`, fix: `Reduce the bay height to ${roomHeightMm} mm or less.`, where: at });

  const heights = moduleHeightsMm(bay, r);
  if (heights.length && heights[0] <= 0) {
    out.push({ code: 'STACK_OVERFLOW', severity: 'error', message: `The upper modules are ${stackZoneMm(bay.outerHeightMm, r) - heights[0]} mm in all, but the stack only has ${stackZoneMm(bay.outerHeightMm, r)} mm.`, fix: `Make the upper modules ${1 - heights[0]} mm shorter in total, or make the bay taller.`, where: at });
  }

  let deepest = 0;
  let deepestModule: BayModule | undefined;
  for (const m of bay.modules) { const d = depthNeededMm(m, r); if (d > deepest) { deepest = d; deepestModule = m; } }
  if (deepestModule && internalDepthMm(bay.outerDepthMm, r) < deepest) {
    const p = profileOf(deepestModule.bottleProfile);
    const kind = deepestModule.storageStyle === 'LABEL_FORWARD' ? 'display' : 'bottle';
    out.push({
      code: deepestModule.storageStyle === 'LABEL_FORWARD' ? 'DISPLAY_DEPTH_TOO_SHALLOW' : 'DEPTH_TOO_SHALLOW', severity: 'error',
      message: `Insufficient depth for ${p.label} ${kind}s (${Math.round(deepest)} mm needed inside, ${internalDepthMm(bay.outerDepthMm, r)} mm available).`,
      fix: `Expand the bay depth to at least ${minOuterDepthMm(deepest, r)} mm.`, where: at,
    });
  }

  bay.modules.forEach((m, i) => {
    const mr = res.modules[i];
    if (!mr) return;
    const p = profileOf(m.bottleProfile);
    if (m.storageStyle === 'CASE_DRAWER') { out.push({ code: 'CASE_DRAWER_NOT_COUNTED', severity: 'info', message: 'Case drawers hold no counted bottles in this version.', where: m.id }); return; }
    const needOne = m.storageStyle === 'LABEL_FORWARD' ? displayClearMm(p, r) : p.minClearMm;
    if (heights[i] > 0 && mr.rows === 0) out.push({ code: 'MODULE_TOO_SHORT', severity: 'error', message: `This module is too short for one row of ${p.label} bottles (${Math.ceil(needOne)} mm clear needed, ${Math.round(mr.netHeightMm)} mm available).`, fix: `Make it at least ${Math.ceil(needOne) + (i > 0 ? r.boardMm : 0)} mm tall.`, where: m.id });
    if (m.storageStyle === 'SCALLOPED_CRADLE' && mr.rows > 0 && mr.clearMm > p.minClearMm + r.excessRowWarnMm) {
      out.push({ code: 'ROW_HEIGHT_EXCESSIVE', severity: 'info', message: `Excessive row height detected (${mr.clearMm.toFixed(1)} mm clear for ${p.label} bottles).`, fix: 'Consider adding another shelf row or reducing the bay height.', where: m.id });
    }
    if (mr.rows > 0 && mr.slotsPerRow === 0) out.push({ code: 'BAY_TOO_NARROW', severity: 'error', message: `The bay is too narrow for one ${p.label} bottle across (${netWidthMm(bay.widthMm, r)} mm inside, ${p.slotPitchMm} mm needed).`, fix: `Make the bay at least ${targetWidthMm(1, p, r)} mm wide.`, where: m.id });
    const spare = netWidthMm(bay.widthMm, r) - mr.slotsPerRow * p.slotPitchMm;
    if (mr.slotsPerRow > 0 && spare >= p.slotPitchMm / 2) {
      out.push({ code: 'WIDTH_WASTE', severity: 'info', message: `${spare} mm of width is unused beside the ${mr.slotsPerRow} bottles in each row.`, fix: `${targetWidthMm(mr.slotsPerRow, p, r)} mm wide wastes none, and ${targetWidthMm(mr.slotsPerRow + 1, p, r)} mm wide holds one more per row.`, where: m.id });
    }
  });
  return out;
}

export function checkWall(wall: Wall, walls: Wall[], r: ConstructionRules): Issue[] {
  const out: Issue[] = [];
  const length = wallLengthMm(wall);
  const owner = (which: 'start' | 'end'): number => {
    const adj = adjacentWall(wall, which, walls);
    return adj ? Math.max(0, ...adj.bays.map((b) => b.outerDepthMm)) : 0;
  };
  const ext = runExtent(length, wall.startTermination, wall.endTermination, owner('start'), owner('end'), r);
  const bays = [...wall.bays].sort((a, b) => a.xMm - b.xMm);
  bays.forEach((b, i) => {
    if (b.xMm < ext.startOffsetMm) out.push({ code: 'RUN_OVERFLOW', severity: 'error', message: `This bay starts ${ext.startOffsetMm - b.xMm} mm inside the scribe or corner allowance.`, fix: `Move it to ${ext.startOffsetMm} mm or further along the wall.`, where: b.id });
    if (b.xMm + b.widthMm > length - ext.endOffsetMm) out.push({ code: 'RUN_OVERFLOW', severity: 'error', message: `This bay runs ${b.xMm + b.widthMm - (length - ext.endOffsetMm)} mm past the end of the usable wall.`, fix: 'Make it narrower or move it back.', where: b.id });
    const next = bays[i + 1];
    if (next && b.xMm + b.widthMm > next.xMm) out.push({ code: 'BAY_OVERLAP', severity: 'error', message: `Two bays overlap by ${b.xMm + b.widthMm - next.xMm} mm.`, where: b.id });
  });
  return out;
}

/** Corners: exactly one of the two walls meeting at a corner may own it. */
export function checkCorners(walls: Wall[]): Issue[] {
  const out: Issue[] = [];
  const seen = new Set<string>();
  for (const w of walls) {
    for (const which of ['start', 'end'] as const) {
      const adj = adjacentWall(w, which, walls);
      if (!adj) continue;
      const key = [w.id, adj.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const wTerm = which === 'start' ? w.startTermination : w.endTermination;
      const aTerm = adj.start[0] === (which === 'start' ? w.start : w.end)[0] && adj.start[1] === (which === 'start' ? w.start : w.end)[1] ? adj.startTermination : adj.endTermination;
      if (wTerm === 'CORNER_OWNS' && aTerm === 'CORNER_OWNS') out.push({ code: 'CORNER_BOTH_OWN', severity: 'error', message: `Walls ${w.id} and ${adj.id} both claim the same corner.`, fix: 'Let one wall yield the corner.', where: w.id });
      else if (wTerm === 'CORNER_YIELDS' && aTerm === 'CORNER_YIELDS') out.push({ code: 'CORNER_NO_OWNER', severity: 'error', message: `Walls ${w.id} and ${adj.id} both yield the same corner, so nothing owns it.`, fix: 'Let one wall own the corner.', where: w.id });
    }
  }
  return out;
}
