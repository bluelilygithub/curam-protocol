import { describe, expect, it } from 'vitest';
import { analyseApp, fullRuns } from '../src/app/model';
import { BOTTLES, DOOR_POSITIONS, WALLS, defaultLite, liteResult, type LiteSettings } from '../src/lite/settings';
import { MAX_PHOTO_BOTTLES, buildPhotoGeometry, photoPose } from '../src/lite/photoGeometry';
import { PHOTO_QUALITIES, PHOTO_SIZES, RENDERS_PER_VISIT, RENDER_COUNT_KEY, rendersUsed } from '../src/lite/PhotoModal';
import type { FeatureEffect } from '../src/lite/config';

const geometryFor = (s: LiteSettings, effects: FeatureEffect[] = []) => {
  const r = liteResult(s);
  const analysis = analyseApp(r.project);
  return { r, g: buildPhotoGeometry({ project: r.project, runs: fullRuns(r.project), analysis: analysis.racks, effects }) };
};

describe('Render photo: the design as real shapes', () => {
  it('draws as many bottles as the planner counts, and only racks that can be built', () => {
    const { r, g } = geometryFor(defaultLite());
    expect(g.stats.bottles).toBe(r.bottles);
    expect(g.stats.racks).toBeGreaterThan(0);
    expect(g.bottles).toHaveLength(r.bottles);
  });

  it('every bottle lies inside the room and its rack, with the neck towards the open front', () => {
    for (const doorWall of WALLS) for (const bottle of BOTTLES) {
      const { g } = geometryFor({ ...defaultLite(), doorWall, bottle });
      for (const b of g.bottles) {
        expect(b.x).toBeGreaterThan(0); expect(b.x).toBeLessThan(g.widthMm);
        expect(b.y).toBeGreaterThan(0); expect(b.y).toBeLessThan(g.depthMm);
        expect(b.z).toBeGreaterThan(0); expect(b.z).toBeLessThan(g.heightMm);
        expect(b.radius).toBeGreaterThan(20); expect(b.length).toBeGreaterThan(100);
      }
      // each rack's bottles are inside its own box
      for (const rack of g.racks) {
        const own = g.bottles.filter((b) => b.dir === rack.open && b.x >= rack.x0 - 1 && b.x <= rack.x1 + 1 && b.y >= rack.y0 - 1 && b.y <= rack.y1 + 1);
        expect(own.length).toBeGreaterThan(0);
      }
    }
  });

  it('a rack is open to the room: the open side faces away from the wall it stands against', () => {
    for (const doorWall of WALLS) {
      const { r, g } = geometryFor({ ...defaultLite(), doorWall });
      for (const run of fullRuns(r.project)) {
        const rack = g.racks.find((x) => x.id === run.id);
        if (!rack) continue;
        expect(rack.open).toBe({ NORTH: 'S', SOUTH: 'N', WEST: 'E', EAST: 'W' }[run.wall]);
      }
    }
  });

  it('never makes more bottles than the safety ceiling, even for the biggest room', () => {
    const { g } = geometryFor({ ...defaultLite(), widthMm: 8000, depthMm: 8000, heightMm: 3200, target: 5000 });
    expect(g.bottles.length).toBeLessThanOrEqual(MAX_PHOTO_BOTTLES);
  });

  it('feature picks change the look: floors, walls, lights, a centre piece', () => {
    const { g } = geometryFor(defaultLite(), ['FLOOR_STONE', 'WALL_TIMBER', 'LIGHT_DOWNLIGHTS', 'CENTRE_ISLAND', 'GLASS_DOORS']);
    expect(g.effects).toContain('FLOOR_STONE');
    expect(g.downlights.length).toBeGreaterThan(0);
    expect(g.centrePiece).not.toBeNull();
    expect(g.door.kind).toBe('glass');
    const plain = geometryFor(defaultLite()).g;
    expect(plain.downlights).toEqual([]);
    expect(plain.centrePiece).toBeNull();
    expect(plain.door.kind).toBe('none');
  });

  it('the camera is inside the room at eye height for the doorway view, and outside and above for the overview', () => {
    for (const doorWall of WALLS) for (const doorPos of DOOR_POSITIONS) {
      const { g } = geometryFor({ ...defaultLite(), doorWall, doorPos });
      const d = photoPose(g, 'door');
      expect(d.position[0]).toBeGreaterThan(0); expect(d.position[0]).toBeLessThan(g.widthMm);
      expect(d.position[1]).toBeGreaterThan(0); expect(d.position[1]).toBeLessThan(g.depthMm);
      expect(d.position[2]).toBeGreaterThan(1000); expect(d.position[2]).toBeLessThan(g.heightMm);
      const o = photoPose(g, 'overview');
      const outside = o.position[0] < 0 || o.position[0] > g.widthMm || o.position[1] < 0 || o.position[1] > g.depthMm;
      expect(outside).toBe(true);
      expect(o.position[2]).toBeGreaterThan(g.heightMm);
    }
  });

  it('the pose and geometry are finite numbers for every size at the limits', () => {
    for (const [w, dpt, h] of [[1000, 1000, 1800], [8000, 8000, 3200], [1000, 8000, 2400]] as const) {
      const { g } = geometryFor({ ...defaultLite(), widthMm: w, depthMm: dpt, heightMm: h });
      for (const v of ['door', 'overview'] as const) {
        const p = photoPose(g, v);
        for (const n of [...p.position, ...p.target, p.fov]) expect(Number.isFinite(n)).toBe(true);
      }
    }
  });
});

describe('Render photo: what the visitor is told and allowed', () => {
  it('offers sizes and qualities a visitor can wait for (no 4K, no Best), each with an honest time', () => {
    expect(PHOTO_SIZES.map((s) => s.id)).not.toContain('uhd');
    expect(PHOTO_QUALITIES.map((q) => q.id)).toEqual(['draft', 'good']);
    for (const q of PHOTO_QUALITIES) expect(q.time).toMatch(/minute/);
  });

  it('the fair-use limit is a few pictures per visit, read safely from storage', () => {
    expect(RENDERS_PER_VISIT).toBeGreaterThanOrEqual(1);
    expect(RENDERS_PER_VISIT).toBeLessThanOrEqual(5);
    const store = (v: string | null) => ({ getItem: (k: string) => (k === RENDER_COUNT_KEY ? v : null) });
    expect(rendersUsed(store(null))).toBe(0);
    expect(rendersUsed(store('2'))).toBe(2);
    expect(rendersUsed(store('-4'))).toBe(0);
    expect(rendersUsed(store('abc'))).toBe(0);
    expect(rendersUsed(store('1e9'))).toBe(99); // a huge number is capped, which just means none left
    expect(rendersUsed({ getItem: () => { throw new Error('blocked'); } })).toBe(0);
  });
});
