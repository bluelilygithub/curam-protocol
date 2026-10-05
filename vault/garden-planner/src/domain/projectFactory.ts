import { suggestClimate, suggestFrost } from './climate';
import { FENCE_HEIGHT, type Boundary, type FenceType, type GardenProject, type Location, type Vec2 } from './types';

export const randomId = (): string => {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const DEFAULT_LOCATION: Location = { label: 'Sydney NSW', lat: -33.87, lng: 151.21, state: 'NSW', postcode: '2000' };

/** A fresh, empty project with the climate suggested from its location. */
export function newGardenProject(name = 'My garden', location: Location = DEFAULT_LOCATION, id: string = randomId()): GardenProject {
  const climateZone = suggestClimate(location.lat, location.lng, location.state);
  return {
    schemaVersion: 1, id, name, location, climateZone, frost: suggestFrost(climateZone, location.state),
    pets: false, northDeg: 0, boundary: null, house: null,
    zones: [], beds: [], paths: [], services: [], lawns: [], structures: [], plants: [],
  };
}

/** A boundary from corner points; every edge gets the same fence. */
export function boundaryFromPoints(points: Vec2[], fence: FenceType = 'timber_paling', newId: () => string = randomId): Boundary {
  return {
    vertices: points.map((position) => ({ id: newId(), position })),
    segments: points.map(() => ({ fence, height: FENCE_HEIGHT[fence] })),
  };
}

export function rectanglePoints(width: number, depth: number, origin: Vec2 = { x: 0, y: 0 }): Vec2[] {
  return [
    { x: origin.x, y: origin.y }, { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + depth }, { x: origin.x, y: origin.y + depth },
  ];
}

/** Trim, collapse spaces, limit the length; a blank result keeps the fallback. */
export function cleanName(raw: string, fallback: string, max = 80): string {
  const n = raw.trim().replace(/\s+/g, ' ').slice(0, max);
  return n || fallback;
}

/** True for a garden nothing has been drawn or planted in yet (the one a new library starts with). */
export function isBlank(p: GardenProject): boolean {
  return !p.boundary && !p.house && !p.underlay && !p.zones.length && !p.beds.length && !p.paths.length && !p.services.length && !p.lawns.length && !p.structures.length && !p.plants.length;
}

/** An independent copy under a new name: new project id and new ids on everything inside it. */
export function cloneGarden(p: GardenProject, newId: () => string, name: string): GardenProject {
  const c = structuredClone(p);
  const fresh = <T extends { id: string }>(list: T[]): T[] => list.map((x) => ({ ...x, id: newId() }));
  return {
    ...c, id: newId(), name,
    zones: fresh(c.zones), beds: fresh(c.beds), paths: fresh(c.paths), services: fresh(c.services ?? []), lawns: fresh(c.lawns), structures: fresh(c.structures), plants: fresh(c.plants),
    boundary: c.boundary ? { ...c.boundary, vertices: fresh(c.boundary.vertices) } : null,
    house: c.house ? { ...c.house, id: newId(), vertices: fresh(c.house.vertices), fixtures: fresh(c.house.fixtures) } : null,
    ...(c.savedViews ? { savedViews: fresh(c.savedViews) } : {}),
  };
}
