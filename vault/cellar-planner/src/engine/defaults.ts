import type { BottleProfile, BottleProfileId, ConstructionRules } from './types';

/**
 * Typical Australian joinery defaults. DRAFT: confirm with the cabinet maker before fabrication. Every value can be overridden per project.
 * Depth: 350 outer -> 350 - 12 (front margin) - 10 (rebate: 6 back panel + 4 void) = 328 internal.
 */
export const DEFAULT_RULES: ConstructionRules = {
  boardMm: 16,
  backPanelMm: 6,
  rebateMm: 10,
  frontMarginMm: 12,
  plinthMm: 100,
  topShadowRailMm: 50,
  scribeMm: 50,
  cornerClearanceMm: 20,
  depthClearanceMm: 15,
  excessRowWarnMm: 40,
  displayAngleDeg: 15,
  displayLipMm: 20,
  displayHandClearanceMm: 25,
  sheetMaterial: '16 mm HMR particleboard/MDF',
};

/** Typical sizes. DRAFT, unverified: the diameter is the largest in the usual range, so a rack built for it holds the whole range. */
export const BOTTLE_PROFILES: Readonly<Record<BottleProfileId, BottleProfile>> = {
  BORDEAUX: { id: 'BORDEAUX', label: 'Bordeaux / Shiraz', diameterMm: 76, lengthMm: 300, minClearMm: 100, slotPitchMm: 85 },
  BURGUNDY: { id: 'BURGUNDY', label: 'Burgundy / Pinot / Chardonnay', diameterMm: 90, lengthMm: 310, minClearMm: 110, slotPitchMm: 100 },
  CHAMPAGNE: { id: 'CHAMPAGNE', label: 'Champagne / Sparkling', diameterMm: 98, lengthMm: 320, minClearMm: 120, slotPitchMm: 105 },
  MAGNUM: { id: 'MAGNUM', label: 'Magnum (1.5 L)', diameterMm: 115, lengthMm: 370, minClearMm: 130, slotPitchMm: 125 },
};

export const profileOf = (id: BottleProfileId): BottleProfile => BOTTLE_PROFILES[id];
