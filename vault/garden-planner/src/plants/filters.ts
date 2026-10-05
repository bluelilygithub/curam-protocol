// Plant library search and filters (spec 7.1). Pure, so it is tested without a browser.
import type { SiteConditions } from './suitability';
import { suitsSite } from './suitability';
import { mid } from './growth';
import type { Feature, PlantRecord, PlantType, Sun, Water } from './types';

export type ColourFamily = 'red' | 'pink' | 'orange' | 'yellow' | 'white' | 'purple' | 'blue' | 'green';
export const COLOUR_FAMILIES: readonly ColourFamily[] = ['red', 'pink', 'orange', 'yellow', 'white', 'purple', 'blue'];

/** Which broad colour a flower hex falls in. */
export function colourFamily(hex: string): ColourFamily {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.82 && s < 0.5) return 'white';
  if (s < 0.12) return 'white';
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60; if (hue < 0) hue += 360;
  }
  if (hue < 15 || hue >= 345) return l > 0.68 ? 'pink' : 'red';
  if (hue < 40) return l > 0.7 ? 'pink' : 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 170) return 'green';
  if (hue < 255) return 'blue';
  if (hue < 300) return 'purple';
  return l > 0.6 ? 'pink' : 'purple';
}

export interface PlantFilters {
  text: string;
  type: PlantType | 'any';
  origin: 'any' | 'native' | 'exotic';
  sun: Sun | 'any';
  water: Water | 'any';
  /** Month 1-12 the plant flowers in, or 0 for any. */
  flowerMonth: number;
  colour: ColourFamily | 'any';
  features: Feature[];
  /** Max mature height (m), 0 = no limit. */
  maxHeight: number;
  /** Max mature spread (m), 0 = no limit. */
  maxSpread: number;
}

export const NO_FILTERS: PlantFilters = { text: '', type: 'any', origin: 'any', sun: 'any', water: 'any', flowerMonth: 0, colour: 'any', features: [], maxHeight: 0, maxSpread: 0 };

export function matchesText(p: PlantRecord, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  const hay = [p.botanical, p.cultivar ?? '', ...p.common].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function filterPlants(plants: readonly PlantRecord[], f: PlantFilters, site: SiteConditions | null): PlantRecord[] {
  return plants.filter((p) => {
    if (site && !suitsSite(p, site)) return false;
    if (!matchesText(p, f.text)) return false;
    if (f.type !== 'any' && p.type !== f.type) return false;
    if (f.origin === 'native' && !p.native) return false;
    if (f.origin === 'exotic' && p.native) return false;
    if (f.sun !== 'any' && !p.sun.includes(f.sun)) return false;
    if (f.water !== 'any' && p.water !== f.water) return false;
    if (f.flowerMonth && !p.flowerMonths.includes(f.flowerMonth)) return false;
    if (f.colour !== 'any' && !p.flowerColours.some((c) => colourFamily(c) === f.colour)) return false;
    if (f.features.length && !f.features.every((x) => p.features.includes(x))) return false;
    if (f.maxHeight && mid(p.height) > f.maxHeight) return false;
    if (f.maxSpread && mid(p.spread) > f.maxSpread) return false;
    return true;
  }).sort((a, b) => (a.common[0] ?? a.botanical).localeCompare(b.common[0] ?? b.botanical));
}
