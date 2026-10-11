import { describe, expect, it } from 'vitest';
import { ALL_CATEGORY_IDS, DEFAULT_CATEGORIES, flatten, nearestRadius, pickRoute, radiusOptions, readCats, toFeatures, visiblePlaces, type Place, type RouteSources } from '../src/placesModel';

const line = (n: number, lat = -27.5): [number, number][] => Array.from({ length: n }, (_, i) => [153 + i * 0.01, lat]);
const base: RouteSources = { planActive: false, planRoutes: [], planSelected: 0, drawing: false, drawLines: [], track: null };
const track = { name: 'Morning loop', geometry: { coordinates: [line(5), line(3, -27.4)] } };

describe('which route is meant', () => {
  it('nothing yet', () => {
    expect(pickRoute(base)).toBeNull();
    expect(pickRoute({ ...base, drawing: true, drawLines: [[[153, -27]]] })).toBeNull(); // one point is not a route
    expect(pickRoute({ ...base, planActive: true })).toBeNull();
  });
  it('the open track, its strokes joined into one line', () => {
    const r = pickRoute({ ...base, track });
    expect(r?.label).toBe('Morning loop');
    expect(r?.line).toHaveLength(8);
    expect(flatten([[[1, 2]], [[3, 4]]])).toEqual([[1, 2], [3, 4]]);
  });
  it('a planned route beats a drawing beats the open track, and the selected option is the one used', () => {
    const routes = [{ coordinates: line(4) }, { coordinates: line(6) }];
    expect(pickRoute({ ...base, track, drawing: true, drawLines: [line(3)], planActive: true, planRoutes: routes, planSelected: 1 })).toMatchObject({ label: 'The planned route' });
    expect(pickRoute({ ...base, track, drawing: true, drawLines: [line(3)], planActive: true, planRoutes: routes, planSelected: 1 })?.line).toHaveLength(6);
    expect(pickRoute({ ...base, track, drawing: true, drawLines: [line(3)] })).toMatchObject({ label: 'The route you are drawing' });
    expect(pickRoute({ ...base, planActive: true, planRoutes: routes, planSelected: 99 })?.line).toHaveLength(6); // a stale index is held to the last option
    expect(pickRoute({ ...base, planActive: true, planRoutes: routes, planSelected: -3 })?.line).toHaveLength(4);
    expect(pickRoute({ ...base, planActive: false, planRoutes: routes, track })?.label).toBe('Morning loop'); // plan results are ignored once planning is closed
  });
  it('the key changes when the route changes', () => {
    const a = pickRoute({ ...base, track })?.key;
    expect(pickRoute({ ...base, track })?.key).toBe(a);
    expect(pickRoute({ ...base, track: { ...track, geometry: { coordinates: [line(6)] } } })?.key).not.toBe(a);
    expect(pickRoute({ ...base, track: { ...track, name: 'Other' } })?.key).not.toBe(a);
  });
});

describe('distances', () => {
  it('kilometres, or miles converted for the server', () => {
    expect(radiusOptions('km').map((o) => o.label)).toEqual(['0.5 km', '1 km', '2 km', '5 km', '10 km']);
    const mi = radiusOptions('mi');
    expect(mi.map((o) => o.label)).toEqual(['0.25 mi', '0.5 mi', '1 mi', '2 mi', '5 mi']);
    expect(mi[2].km).toBeCloseTo(1.609, 3);
    expect(Math.max(...mi.map((o) => o.km))).toBeLessThanOrEqual(10); // never more than the server accepts
    expect(Math.min(...radiusOptions('km').map((o) => o.km))).toBeGreaterThanOrEqual(0.1);
  });
  it('a remembered distance finds the nearest offered one, in either units', () => {
    expect(nearestRadius('km', 2)).toBe(2);
    expect(nearestRadius('km', 3.4)).toBe(2);
    expect(nearestRadius('km', 3.6)).toBe(5);
    expect(nearestRadius('km', 0.01)).toBe(0.5);
    expect(nearestRadius('mi', 1.609)).toBeCloseTo(1.609, 2);
    expect(nearestRadius('mi', 2)).toBeCloseTo(1.609, 2);
  });
});

const place = (id: string, category: string, distKm: number, name = id): Place => ({ id, name, category, lat: -27.5, lng: 153, distKm, notable: false });
const cats = [{ id: 'museums', label: 'Museums and galleries', color: '#7048e8' }, { id: 'shows', label: 'Theatres and cinemas', color: '#c2255c' }];

describe('which places show', () => {
  const all = [place('a', 'museums', 1.2), place('b', 'shows', 0.3), place('c', 'worship', 0.1), place('d', 'museums', 0.3, 'Aardvark')];
  it('only the kinds switched on, nearest first, ties by name', () => {
    expect(visiblePlaces(all, new Set(['museums', 'shows'])).map((p) => p.id)).toEqual(['d', 'b', 'a']);
    expect(visiblePlaces(all, new Set(['worship'])).map((p) => p.id)).toEqual(['c']);
    expect(visiblePlaces(all, new Set())).toEqual([]);
  });
  it('does not change what it was given', () => {
    const copy = [...all];
    visiblePlaces(all, new Set(['museums', 'shows']));
    expect(all).toEqual(copy);
  });
  it('the map is given a coloured point per place with a readable category and distance', () => {
    const fc = toFeatures([place('a', 'museums', 1.2, 'City Museum')], cats);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [153, -27.5] });
    expect(fc.features[0].properties).toMatchObject({ name: 'City Museum', category: 'Museums and galleries', color: '#7048e8', distKm: 1.2 });
    expect(toFeatures([place('z', 'unknown', 1)], cats).features[0].properties).toMatchObject({ category: 'unknown', color: '#555555' });
    expect(toFeatures([], cats).features).toEqual([]);
  });
});

describe('remembered choices', () => {
  it('known kinds only, or the defaults', () => {
    expect(readCats('["museums","shows","nonsense",5]', ALL_CATEGORY_IDS, DEFAULT_CATEGORIES)).toEqual(['museums', 'shows']);
    expect(readCats('[]', ALL_CATEGORY_IDS, DEFAULT_CATEGORIES)).toEqual([]); // switching everything off is a choice too
    for (const bad of [null, '', 'not json', '{"a":1}', '"x"', '5']) expect(readCats(bad, ALL_CATEGORY_IDS, DEFAULT_CATEGORIES)).toEqual(DEFAULT_CATEGORIES);
  });
  it('the defaults are the buildings, landmarks and venues, without worship, universities and hospitals', () => {
    expect(DEFAULT_CATEGORIES).not.toContain('worship');
    expect(DEFAULT_CATEGORIES).not.toContain('campus');
    expect(DEFAULT_CATEGORIES.every((c) => ALL_CATEGORY_IDS.includes(c))).toBe(true);
    expect(ALL_CATEGORY_IDS).toHaveLength(9);
  });
});
