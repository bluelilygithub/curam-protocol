// Plant size over time (spec 4.3: size comes from the species record plus the growth slider, never from free resizing) and what a plant
// looks like in a given month (flowering, deciduous leaf drop). Southern hemisphere seasons: summer = Dec-Feb, winter = Jun-Aug.
import type { PlantRecord, PlantType } from './types';

export type GrowthStage = 'planted' | 'yr1' | 'yr3' | 'yr5' | 'mature';
export const GROWTH_STAGES: readonly GrowthStage[] = ['planted', 'yr1', 'yr3', 'yr5', 'mature'];
export const STAGE_LABEL: Record<GrowthStage, string> = { planted: 'Planted', yr1: '1 year', yr3: '3 years', yr5: '5 years', mature: 'Mature' };

/** Years of growth at each stage; `mature` means "the plant's own years to maturity". */
const STAGE_YEARS: Record<Exclude<GrowthStage, 'mature'>, number> = { planted: 0, yr1: 1, yr3: 3, yr5: 5 };

/** Fraction of mature size a nursery plant has when it goes in the ground. */
const PLANTED_FRACTION: Partial<Record<PlantType, number>> = { tree: 0.06, palm: 0.1, annual: 0.35, edible: 0.2, aquatic: 0.3 };
const DEFAULT_PLANTED_FRACTION = 0.15;

export const mid = (r: [number, number]): number => (r[0] + r[1]) / 2;

export function stageYears(p: PlantRecord, stage: GrowthStage): number {
  return stage === 'mature' ? p.yearsToMature : Math.min(STAGE_YEARS[stage], p.yearsToMature);
}

const RATE_EXPONENT = { slow: 1.3, medium: 1, fast: 0.75 } as const;

/** 0-1: how far to mature size the plant is after `years`. A fast grower is quick early and eases off; a slow one starts slowly. */
export function sizeFraction(p: PlantRecord, years: number): number {
  const start = PLANTED_FRACTION[p.type] ?? DEFAULT_PLANTED_FRACTION;
  const u = Math.max(0, Math.min(1, years / Math.max(0.25, p.yearsToMature)));
  return start + (1 - start) * u ** RATE_EXPONENT[p.growth];
}

export interface PlantSize { height: number; spread: number; canopyRadius: number; fraction: number }

/** Size at a growth stage. At `mature` it is the middle of the record's height and spread ranges (the "typical" mature plant). */
export function plantSizeAt(p: PlantRecord, stage: GrowthStage): PlantSize {
  const fraction = stage === 'mature' ? 1 : sizeFraction(p, stageYears(p, stage));
  const height = mid(p.height) * fraction;
  const spread = mid(p.spread) * fraction;
  return { height, spread, canopyRadius: spread / 2, fraction };
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

export type Season = 'summer' | 'autumn' | 'winter' | 'spring';
export function seasonOf(month: number): Season {
  if (month === 12 || month <= 2) return 'summer';
  if (month <= 5) return 'autumn';
  if (month <= 8) return 'winter';
  return 'spring';
}

/** 0 = bare, 1 = full leaf. Evergreens are always 1. Deciduous plants drop their leaves through autumn and are bare in winter. */
export function leafFactor(p: PlantRecord, month: number): number {
  if (p.foliage === 'evergreen') return 1;
  switch (month) {
    case 5: return 0.35;
    case 6: case 7: case 8: return 0;
    case 9: return 0.4;
    case 10: return 0.8;
    default: return 1;
  }
}

/** Autumn tint of deciduous leaves (0 = none, 1 = full autumn colour). */
export function autumnTint(p: PlantRecord, month: number): number {
  if (p.foliage !== 'deciduous') return 0;
  return month === 4 ? 0.5 : month === 5 ? 1 : 0;
}

export const isFlowering = (p: PlantRecord, month: number): boolean => p.flowerMonths.includes(month);

/** The colour the canopy circle is drawn in this month: foliage colour, shifted for autumn, faded when bare. */
export function canopyColour(p: PlantRecord, month: number): string {
  const tint = autumnTint(p, month);
  return tint > 0 ? mixHex(p.foliageColour, '#c9742a', tint * 0.7) : p.foliageColour;
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  const c = (i: number): string => Math.round(pa[i] + (pb[i] - pa[i]) * t).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? [...h].map((x) => x + x).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
