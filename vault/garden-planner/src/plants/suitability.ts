// Does a plant suit this garden? Used by the "Suits my garden" filter (on by default) and by the checks.
import type { AuState, ClimateZone, Frost, GardenProject } from '../domain/types';
import { FROST_LEVELS } from '../domain/types';
import type { PlantRecord, Sun } from './types';

export const frostRank = (f: Frost): number => FROST_LEVELS.indexOf(f);

export interface SiteConditions { zone: ClimateZone; frost: Frost; state: AuState }
export const siteOf = (p: Pick<GardenProject, 'climateZone' | 'frost' | 'location'>): SiteConditions => ({
  zone: p.climateZone, frost: p.frost, state: p.location.state,
});

export type Unsuitable = 'climate' | 'frost' | 'weed';

/** Why the plant does not suit the site (empty = suits). */
export function unsuitableReasons(plant: PlantRecord, site: SiteConditions): Unsuitable[] {
  const out: Unsuitable[] = [];
  if (!plant.zones.includes(site.zone)) out.push('climate');
  if (frostRank(site.frost) > frostRank(plant.frost)) out.push('frost');
  if (plant.weedStates.includes(site.state)) out.push('weed');
  return out;
}

export const suitsSite = (plant: PlantRecord, site: SiteConditions): boolean => unsuitableReasons(plant, site).length === 0;
export const isWeedIn = (plant: PlantRecord, state: AuState): boolean => plant.weedStates.includes(state);

export const UNSUITABLE_TEXT: Record<Unsuitable, (p: PlantRecord, s: SiteConditions) => string> = {
  climate: (p, s) => `${p.common[0] ?? p.botanical} is not suited to a ${s.zone.replace('_', ' ')} climate.`,
  frost: (p, s) => `${p.common[0] ?? p.botanical} cannot take ${s.frost} frost (it copes with ${p.frost === 'none' ? 'no frost' : `up to ${p.frost} frost`}).`,
  weed: (p, s) => `${p.common[0] ?? p.botanical} is listed as a weed in ${s.state} (draft list, unverified).`,
};

// ---- sun (spec 8: full sun 6+ h, part shade 3-6 h, shade < 3 h; thresholds configurable)
export interface SunThresholds { fullSunHours: number; partShadeHours: number }
export const DEFAULT_SUN_THRESHOLDS: SunThresholds = { fullSunHours: 6, partShadeHours: 3 };

export function sunLevelForHours(hours: number, t: SunThresholds = DEFAULT_SUN_THRESHOLDS): Sun {
  return hours >= t.fullSunHours ? 'full_sun' : hours >= t.partShadeHours ? 'part_shade' : 'shade';
}

export const sunSuits = (plant: PlantRecord, level: Sun): boolean => plant.sun.includes(level);
