import { describe, expect, it } from 'vitest';
import { newGardenProject } from '../src/domain/projectFactory';
import { isLocated, type GardenProject, type Location } from '../src/domain/types';
import { gardenCodec } from '../src/state/library';
import { PRECISION_TEXT } from '../src/state/geocode';
import { deserializeProject, serializeProject } from '../src/state/persistence';
import { createProjectStore } from '../src/state/projectStore';
import { planSheet, refsFor } from '../src/schedule/planSheet';
import { buildPlantSchedule } from '../src/schedule/plantSchedule';

const ADDRESS: Location = { label: 'Paddington QLD', lat: -27.4605, lng: 153.0012, state: 'QLD', postcode: '4064', address: '12 Smith Street, Paddington QLD 4064', precision: 'address' };

describe('a garden with a street address', () => {
  it('knows when the point is as exact as a street or better', () => {
    expect(isLocated({ precision: 'address' })).toBe(true);
    expect(isLocated({ precision: 'street' })).toBe(true);
    expect(isLocated({ precision: 'place' })).toBe(false);
    expect(isLocated({})).toBe(false); // a garden made before addresses existed, or from a typed latitude and longitude
  });

  it('every precision has words for the person', () => {
    expect(PRECISION_TEXT.address).toBe('Exact address');
    expect(PRECISION_TEXT.street).toMatch(/house number was not found/);
    expect(PRECISION_TEXT.place).toMatch(/suburb or place/);
  });

  it('the address and its precision are saved with the garden and come back', () => {
    const p = newGardenProject('Home', ADDRESS, 'g1');
    const back = deserializeProject(serializeProject(p));
    expect(back.location).toEqual(ADDRESS);
    expect(isLocated(back.location)).toBe(true);
  });

  it('an older garden with no address still opens, as a place', () => {
    const p = newGardenProject('Old', { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, 'g2');
    const back = deserializeProject(serializeProject(p));
    expect(back.location.address).toBeUndefined();
    expect(isLocated(back.location)).toBe(false);
  });

  it('the list of gardens shows only the short place name, never the street address', () => {
    const p = newGardenProject('Home', ADDRESS, 'g1');
    expect(gardenCodec.extra(p)).toEqual({ plantCount: 0, location: 'Paddington QLD' });
    expect(JSON.stringify(gardenCodec.extra(p))).not.toMatch(/Smith/);
  });

  it('changing the address and moving the map is one undo step, and undo puts both back', () => {
    const store = createProjectStore(null);
    const p: GardenProject = { ...newGardenProject('Home', ADDRESS, 'g1'), map: { on: true, lat: ADDRESS.lat, lng: ADDRESS.lng, opacity: 0.8 } };
    store.getState().load(p);
    const next: Location = { label: 'Toowong QLD', lat: -27.4849, lng: 152.9857, state: 'QLD', address: '1 High Street, Toowong QLD 4066', precision: 'address' };
    const ok = store.getState().commit({
      type: 'Composite',
      commands: [
        { type: 'SetMeta', from: { location: p.location }, to: { location: next } },
        { type: 'SetSingleton', name: 'map', from: p.map ?? null, to: { ...p.map!, lat: next.lat, lng: next.lng } },
      ],
    }, 'Change address');
    expect(ok).toBe(true);
    const after = store.getState().project!;
    expect(after.location).toEqual(next);
    expect(after.map).toEqual({ on: true, lat: next.lat, lng: next.lng, opacity: 0.8 });
    store.getState().undo();
    const undone = store.getState().project!;
    expect(undone.location).toEqual(ADDRESS);
    expect(undone.map).toEqual({ on: true, lat: ADDRESS.lat, lng: ADDRESS.lng, opacity: 0.8 });
  });

  it('the printed plan carries the street address; nothing else changes about the sheet', () => {
    const p = newGardenProject('Home', ADDRESS, 'g1');
    const opts = { gardenName: p.name, place: ADDRESS.address!, date: '2026-10-20', paper: 'a4' as const, stage: 'mature' as const, dimensions: false, sheet: 1, sheets: 1, refs: refsFor(buildPlantSchedule(p)) };
    const texts = planSheet(p, opts).prims.filter((q) => q.t === 'text').map((q) => (q as { text: string }).text).join(' | ');
    expect(texts).toContain('12 Smith Street, Paddington QLD 4064');
  });

  it('a very long address is cut so it cannot run into the scale on the title block', () => {
    const p = newGardenProject('Home', ADDRESS, 'g1');
    const long = 'Unit 14, The Residences at Some Very Long Named Development, 1234 Extremely Long Boulevard Road, Mount Somewhere East QLD 4999';
    const opts = { gardenName: p.name, place: long, date: '2026-10-20', paper: 'a4' as const, stage: 'mature' as const, dimensions: false, sheet: 1, sheets: 1, refs: new Map<string, string>() };
    const line = planSheet(p, opts).prims.find((q) => q.t === 'text' && q.text.includes('Unit 14')) as { text: string };
    expect(line.text.endsWith('...')).toBe(true);
    expect(line.text.length).toBeLessThan(long.length);
  });
});
