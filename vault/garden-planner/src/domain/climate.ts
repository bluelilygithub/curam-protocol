// Climate zone and frost suggestions from a location. These are starting points the user can override in the wizard; they are
// deliberately coarse (a latitude/longitude heuristic, not a climate model). Southern hemisphere: lower latitude = closer to the equator.
import type { AuState, ClimateZone, Frost, Location } from './types';

export function suggestClimate(lat: number, lng: number, state: AuState): ClimateZone {
  // Snowy Mountains / Victorian Alps box
  if (lat <= -35.8 && lat >= -37.3 && lng >= 146.3 && lng <= 148.6) return 'alpine';
  if (lat > -21) return 'tropical';
  // dry interior: central Australia, the outback of WA/SA/NSW/QLD
  if (lat > -33 && lng >= 117 && lng <= 145) return 'arid';
  if (lat > -30.5 && lng >= 150.5) return 'subtropical';
  if (state === 'TAS' || state === 'ACT' || lat <= -37.5) return 'cool_temperate';
  return 'warm_temperate';
}

export function suggestFrost(zone: ClimateZone, state: AuState): Frost {
  switch (zone) {
    case 'tropical': return 'none';
    case 'subtropical': return 'none';
    case 'arid': return 'moderate';
    case 'alpine': return 'heavy';
    case 'cool_temperate': return state === 'ACT' ? 'heavy' : 'moderate';
    default: return 'light';
  }
}

export const CLIMATE_LABEL: Record<ClimateZone, string> = {
  tropical: 'Tropical', subtropical: 'Subtropical', warm_temperate: 'Warm temperate',
  cool_temperate: 'Cool temperate', arid: 'Arid / semi-arid', alpine: 'Alpine',
};
export const FROST_LABEL = { none: 'None', light: 'Light', moderate: 'Moderate', heavy: 'Heavy' } as const;

/** Places that work without any network lookup. */
export const KNOWN_PLACES: readonly Location[] = [
  { label: 'Sydney NSW', lat: -33.87, lng: 151.21, state: 'NSW', postcode: '2000' },
  { label: 'Newcastle NSW', lat: -32.93, lng: 151.78, state: 'NSW', postcode: '2300' },
  { label: 'Wollongong NSW', lat: -34.42, lng: 150.89, state: 'NSW', postcode: '2500' },
  { label: 'Coffs Harbour NSW', lat: -30.3, lng: 153.11, state: 'NSW', postcode: '2450' },
  { label: 'Albury NSW', lat: -36.08, lng: 146.92, state: 'NSW', postcode: '2640' },
  { label: 'Broken Hill NSW', lat: -31.95, lng: 141.45, state: 'NSW', postcode: '2880' },
  { label: 'Thredbo NSW', lat: -36.5, lng: 148.3, state: 'NSW', postcode: '2625' },
  { label: 'Melbourne VIC', lat: -37.81, lng: 144.96, state: 'VIC', postcode: '3000' },
  { label: 'Geelong VIC', lat: -38.15, lng: 144.36, state: 'VIC', postcode: '3220' },
  { label: 'Bendigo VIC', lat: -36.76, lng: 144.28, state: 'VIC', postcode: '3550' },
  { label: 'Mildura VIC', lat: -34.19, lng: 142.16, state: 'VIC', postcode: '3500' },
  { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD', postcode: '4000' },
  { label: 'Gold Coast QLD', lat: -28.02, lng: 153.4, state: 'QLD', postcode: '4217' },
  { label: 'Toowoomba QLD', lat: -27.56, lng: 151.95, state: 'QLD', postcode: '4350' },
  { label: 'Townsville QLD', lat: -19.26, lng: 146.82, state: 'QLD', postcode: '4810' },
  { label: 'Cairns QLD', lat: -16.92, lng: 145.77, state: 'QLD', postcode: '4870' },
  { label: 'Perth WA', lat: -31.95, lng: 115.86, state: 'WA', postcode: '6000' },
  { label: 'Bunbury WA', lat: -33.33, lng: 115.64, state: 'WA', postcode: '6230' },
  { label: 'Kalgoorlie WA', lat: -30.75, lng: 121.47, state: 'WA', postcode: '6430' },
  { label: 'Adelaide SA', lat: -34.93, lng: 138.6, state: 'SA', postcode: '5000' },
  { label: 'Hobart TAS', lat: -42.88, lng: 147.33, state: 'TAS', postcode: '7000' },
  { label: 'Launceston TAS', lat: -41.44, lng: 147.14, state: 'TAS', postcode: '7250' },
  { label: 'Canberra ACT', lat: -35.28, lng: 149.13, state: 'ACT', postcode: '2600' },
  { label: 'Darwin NT', lat: -12.46, lng: 130.84, state: 'NT', postcode: '0800' },
  { label: 'Alice Springs NT', lat: -23.7, lng: 133.88, state: 'NT', postcode: '0870' },
];

/** State from an Australian postcode (the standard allocation; a few postcodes straddle borders, which the user can correct). */
export function stateFromPostcode(postcode: string): AuState | null {
  const n = Number(postcode);
  if (!/^\d{4}$/.test(postcode) || !Number.isFinite(n)) return null;
  if ((n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920) || n === 2540 /* Jervis Bay */) return 'ACT';
  if ((n >= 1000 && n <= 2599) || (n >= 2619 && n <= 2899) || (n >= 2921 && n <= 2999)) return 'NSW';
  if ((n >= 3000 && n <= 3999) || (n >= 8000 && n <= 8999)) return 'VIC';
  if ((n >= 4000 && n <= 4999) || (n >= 9000 && n <= 9999)) return 'QLD';
  if (n >= 5000 && n <= 5999) return 'SA';
  if (n >= 6000 && n <= 6999) return 'WA';
  if (n >= 7000 && n <= 7999) return 'TAS';
  if (n >= 800 && n <= 999) return 'NT';
  return null;
}
