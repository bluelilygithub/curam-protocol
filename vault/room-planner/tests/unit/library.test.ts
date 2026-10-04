import { describe, expect, it } from 'vitest';
import { FURNITURE_LIBRARY } from '../../src/data/furnitureLibrary';

const byName = (n: string) => FURNITURE_LIBRARY.find((d) => d.name === n)!;

describe('seed furniture library (C17)', () => {
  it('has the 12 listed starter items first, then the M4.8 additions, all with unique ids', () => {
    expect(FURNITURE_LIBRARY.slice(0, 12).map((d) => d.id)).toEqual(['sofa-3', 'armchair', 'coffee-table', 'side-table', 'dining-table', 'dining-chair', 'bed-queen', 'bedside-table', 'wardrobe', 'desk', 'bookshelf', 'tv-unit']);
    expect(FURNITURE_LIBRARY).toHaveLength(39);
    expect(new Set(FURNITURE_LIBRARY.map((d) => d.id)).size).toBe(39);
  });
  it.each([
    ['3-seat sofa', 2.2, 0.95, 0.85], ['Armchair', 0.85, 0.85, 0.85], ['Coffee table', 1.2, 0.6, 0.42],
    ['Side table', 0.5, 0.5, 0.55], ['Dining table', 1.8, 0.9, 0.75], ['Dining chair', 0.45, 0.52, 0.85],
    ['Queen bed', 1.6, 2.1, 1.0], ['Bedside table', 0.5, 0.4, 0.55], ['Wardrobe', 1.8, 0.6, 2.1],
    ['Desk', 1.4, 0.7, 0.74], ['Bookshelf', 0.9, 0.35, 1.8], ['TV unit', 1.8, 0.45, 0.5],
  ])('%s is %s × %s × %s', (name, w, l, h) => {
    const d = byName(name);
    expect([d.defaultWidth, d.defaultLength, d.defaultHeight]).toEqual([w, l, h]);
  });
  it('clearances match the spec and are all soft', () => {
    const c = (n: string) => byName(n).clearancePolicies ?? [];
    expect(c('3-seat sofa')).toEqual([{ side: 'front', offset: 0.45, severity: 'soft' }]);
    expect(c('Dining table')).toEqual([{ side: 'all', offset: 0.9, severity: 'soft' }]);
    expect(c('Queen bed').map((p) => p.side).sort()).toEqual(['front', 'left', 'right']);
    expect(c('Desk')[0]).toMatchObject({ side: 'front', offset: 0.8 });
    expect(c('Coffee table')).toEqual([]);
    for (const d of FURNITURE_LIBRARY) for (const p of d.clearancePolicies ?? []) expect(p.severity).toBe('soft');
  });
  it('wardrobe and bookshelf are above the 1.2 m cut-plane (rendered dashed in 2D)', () => {
    expect(byName('Wardrobe').defaultHeight).toBeGreaterThan(1.2);
    expect(byName('Bookshelf').defaultHeight).toBeGreaterThan(1.2);
  });
  it('has rugs, plants and a lamp; rugs are in the "rugs" category (floor coverings, which the engine lets furniture stand on)', () => {
    const rugs = FURNITURE_LIBRARY.filter((d) => /rug/i.test(d.name));
    expect(rugs.map((d) => d.id).sort()).toEqual(['rug-rect', 'rug-round', 'rug-runner']);
    for (const r of rugs) { expect(r.category).toBe('rugs'); expect(r.defaultHeight).toBeLessThan(0.03); expect(r.clearancePolicies).toBeUndefined(); }
    expect(FURNITURE_LIBRARY.filter((d) => /plant/i.test(d.name))).toHaveLength(2);
    expect(FURNITURE_LIBRARY.some((d) => /lamp/i.test(d.name))).toBe(true);
  });
});
