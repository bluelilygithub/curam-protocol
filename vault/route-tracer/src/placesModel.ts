import type { Line, Lines, Pos, Units } from './geo';
import { KM_PER_MILE } from './geo';

/**
 * Places near a route: the pure parts. Which route is meant, the distances offered, which places show for the chosen categories, and what
 * the map layer is given. The panel and the map layer are in Places.tsx; the search itself is the server's (POST /api/route-tracks/places).
 */

export interface Place { id: string; name: string; category: string; lat: number; lng: number; distKm: number; notable: boolean }
export interface PlaceCategory { id: string; label: string; color: string }

/** The strokes of a route as one line (a gap between strokes is simply joined: only distance from the route matters here). */
export const flatten = (lines: Lines): Line => lines.flat();

export interface RouteSources {
  planActive: boolean;
  planRoutes: { coordinates: Line }[];
  planSelected: number;
  drawing: boolean;
  drawLines: Lines;
  track: { name: string; geometry: { coordinates: Lines } } | null;
}

export interface RouteChoice { label: string; line: Line; key: string }

/**
 * The route "this route" means: the planned route option that is selected, else the line being drawn, else the open track. null when there
 * is none yet. The key changes whenever the route does, so results can say they were for an earlier one.
 */
export function pickRoute(src: RouteSources): RouteChoice | null {
  let label = ''; let line: Line = [];
  if (src.planActive && src.planRoutes.length) {
    const r = src.planRoutes[Math.min(Math.max(0, src.planSelected), src.planRoutes.length - 1)];
    label = 'The planned route'; line = r.coordinates;
  } else if (src.drawing && flatten(src.drawLines).length >= 2) {
    label = 'The route you are drawing'; line = flatten(src.drawLines);
  } else if (src.track) {
    label = src.track.name; line = flatten(src.track.geometry.coordinates);
  }
  if (line.length < 2) return null;
  const a = line[0]; const b = line[line.length - 1];
  return { label, line, key: `${label}|${line.length}|${a[0].toFixed(5)},${a[1].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)}` };
}

/** The distances offered, as { km (what is sent), label (what is shown) }: kilometres, or miles for people using miles. */
export function radiusOptions(units: Units): { km: number; label: string }[] {
  return units === 'mi'
    ? [0.25, 0.5, 1, 2, 5].map((m) => ({ km: Math.round(m * KM_PER_MILE * 1000) / 1000, label: `${m} mi` }))
    : [0.5, 1, 2, 5, 10].map((k) => ({ km: k, label: `${k} km` }));
}

/** The offered distance closest to one remembered from before (or from the other units). */
export function nearestRadius(units: Units, km: number): number {
  const opts = radiusOptions(units);
  return opts.reduce((best, o) => (Math.abs(o.km - km) < Math.abs(best.km - km) ? o : best), opts[0]).km;
}

/** The places in the categories that are switched on, nearest to the route first. */
export function visiblePlaces(places: Place[], enabled: ReadonlySet<string>): Place[] {
  return places.filter((p) => enabled.has(p.category)).sort((a, b) => a.distKm - b.distKm || a.name.localeCompare(b.name));
}

/** What the map layer is given: a point per place with its colour, a short category label and how far from the route. */
export function toFeatures(places: Place[], categories: PlaceCategory[]): GeoJSON.FeatureCollection {
  const by = new Map(categories.map((c) => [c.id, c]));
  return {
    type: 'FeatureCollection',
    features: places.map((p) => ({
      type: 'Feature',
      id: undefined,
      properties: { id: p.id, name: p.name, category: by.get(p.category)?.label ?? p.category, color: by.get(p.category)?.color ?? '#555555', distKm: p.distKm },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] as Pos },
    })),
  };
}

/** Saved choices read back safely: a list of known category ids, or the defaults. */
export function readCats(raw: string | null, known: string[], defaults: string[]): string[] {
  try {
    const v = JSON.parse(raw ?? 'null') as unknown;
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && known.includes(x));
  } catch { /* use the defaults */ }
  return defaults;
}

/** The categories on the first time, before anyone has chosen: the buildings, landmarks and venues; not worship, universities and hospitals. */
export const DEFAULT_CATEGORIES = ['landmarks', 'museums', 'shows', 'sport', 'fun', 'nightlife', 'civic'];
export const ALL_CATEGORY_IDS = ['landmarks', 'museums', 'shows', 'sport', 'fun', 'nightlife', 'worship', 'civic', 'campus'];
