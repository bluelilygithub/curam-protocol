import { describe, expect, it } from 'vitest';
import { CommandHistoryOf } from '@planner-core/engine/history';
import { apply, inverse, setItem, type Command } from '../src/domain/commands';
import { KNOWN_PLACES, stateFromPostcode, suggestClimate, suggestFrost } from '../src/domain/climate';
import { boundaryFromPoints, newGardenProject, rectanglePoints } from '../src/domain/projectFactory';
import { polylineLength, sampleShape, shapeArea, shapeCentroid } from '../src/domain/shapes';
import type { Bed, GardenProject } from '../src/domain/types';

const bed = (id: string): Bed => ({ id, name: id, shape: { points: rectanglePoints(2, 1), smooth: false }, edging: 'none', mulch: 'bark', raised: false });
const fresh = (): GardenProject => newGardenProject('t', undefined, 'p1');

describe('climate suggestions', () => {
  const zone = (label: string): string => {
    const p = KNOWN_PLACES.find((x) => x.label === label)!;
    return suggestClimate(p.lat, p.lng, p.state);
  };
  it('puts the capitals where gardeners expect', () => {
    expect(zone('Brisbane QLD')).toBe('subtropical');
    expect(zone('Darwin NT')).toBe('tropical');
    expect(zone('Cairns QLD')).toBe('tropical');
    expect(zone('Sydney NSW')).toBe('warm_temperate');
    expect(zone('Perth WA')).toBe('warm_temperate');
    expect(zone('Adelaide SA')).toBe('warm_temperate');
    expect(zone('Melbourne VIC')).toBe('cool_temperate');
    expect(zone('Hobart TAS')).toBe('cool_temperate');
    expect(zone('Canberra ACT')).toBe('cool_temperate');
    expect(zone('Alice Springs NT')).toBe('arid');
    expect(zone('Thredbo NSW')).toBe('alpine');
  });
  it('suggests frost to match', () => {
    expect(suggestFrost('tropical', 'NT')).toBe('none');
    expect(suggestFrost('alpine', 'NSW')).toBe('heavy');
    expect(suggestFrost('cool_temperate', 'ACT')).toBe('heavy');
  });
  it('reads the state from a postcode', () => {
    expect(stateFromPostcode('2000')).toBe('NSW');
    expect(stateFromPostcode('2600')).toBe('ACT');
    expect(stateFromPostcode('3000')).toBe('VIC');
    expect(stateFromPostcode('4000')).toBe('QLD');
    expect(stateFromPostcode('5000')).toBe('SA');
    expect(stateFromPostcode('6000')).toBe('WA');
    expect(stateFromPostcode('7000')).toBe('TAS');
    expect(stateFromPostcode('0800')).toBe('NT');
    expect(stateFromPostcode('abc')).toBeNull();
  });
});

describe('shapes', () => {
  it('measures a rectangle', () => {
    expect(shapeArea({ points: rectanglePoints(4, 3), smooth: false })).toBeCloseTo(12);
    expect(shapeCentroid({ points: rectanglePoints(4, 3), smooth: false })).toEqual({ x: 2, y: 1.5 });
  });
  it('a smooth shape samples to more points and stays close in area to the polygon through its points', () => {
    const pts = rectanglePoints(4, 4);
    const sm = sampleShape({ points: pts, smooth: true });
    expect(sm.length).toBeGreaterThan(pts.length * 5);
    expect(shapeArea({ points: pts, smooth: true })).toBeGreaterThan(10);
    expect(shapeArea({ points: pts, smooth: true })).toBeLessThan(24);
  });
  it('measures a polyline', () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBeCloseTo(11);
  });
});

describe('commands and undo', () => {
  it('adds, updates and removes an item, and each inverts exactly', () => {
    const p0 = fresh();
    const add = setItem('beds', 'b1', null, bed('b1'));
    const p1 = apply(add, p0);
    expect(p1.beds).toHaveLength(1);
    const renamed = setItem('beds', 'b1', bed('b1'), { ...bed('b1'), name: 'Herbs' });
    const p2 = apply(renamed, p1);
    expect(p2.beds[0].name).toBe('Herbs');
    const del = setItem('beds', 'b1', p2.beds[0], null);
    const p3 = apply(del, p2);
    expect(p3.beds).toHaveLength(0);
    expect(apply(inverse(del), p3)).toEqual(p2);
    expect(apply(inverse(renamed), p2)).toEqual(p1);
    expect(apply(inverse(add), p1)).toEqual(p0);
  });

  it('does not mutate its input', () => {
    const p0 = fresh();
    const frozen = structuredClone(p0);
    apply(setItem('beds', 'b1', null, bed('b1')), p0);
    expect(p0).toEqual(frozen);
  });

  it('refuses to add an existing id or remove a missing one', () => {
    const p1 = apply(setItem('beds', 'b1', null, bed('b1')), fresh());
    expect(() => apply(setItem('beds', 'b1', null, bed('b1')), p1)).toThrow(/ID_EXISTS|ID_NOT_FOUND/);
    expect(() => apply(setItem('beds', 'zz', bed('zz'), null), p1)).toThrow(/ID_NOT_FOUND/);
  });

  it('sets and clears the boundary and the underlay', () => {
    const b = boundaryFromPoints(rectanglePoints(10, 20));
    const set: Command = { type: 'SetSingleton', name: 'boundary', from: null, to: b };
    const p1 = apply(set, fresh());
    expect(p1.boundary?.vertices).toHaveLength(4);
    expect(p1.boundary?.segments).toHaveLength(4);
    expect(apply(inverse(set), p1).boundary).toBeNull();
  });

  it('SetMeta changes the wizard answers and inverts', () => {
    const p0 = fresh();
    const c: Command = { type: 'SetMeta', from: { frost: p0.frost, pets: false }, to: { frost: 'heavy', pets: true } };
    const p1 = apply(c, p0);
    expect(p1.frost).toBe('heavy');
    expect(p1.pets).toBe(true);
    expect(apply(inverse(c), p1)).toEqual(p0);
  });

  it('a composite undoes in reverse order through the shared history', () => {
    const h = new CommandHistoryOf<GardenProject, Command>({ apply, inverse });
    let p = fresh();
    const cmd: Command = { type: 'Composite', commands: [setItem('beds', 'a', null, bed('a')), setItem('beds', 'b', null, bed('b'))] };
    p = apply(cmd, p); h.push(cmd, 'Add two beds');
    expect(p.beds).toHaveLength(2);
    expect(h.undoLabel()).toBe('Add two beds');
    p = h.undo(p)!;
    expect(p.beds).toHaveLength(0);
    p = h.redo(p)!;
    expect(p.beds.map((b) => b.id)).toEqual(['a', 'b']);
  });
});
