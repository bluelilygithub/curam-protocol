import { describe, expect, it } from 'vitest';
import { canvasToWorld, worldToCanvas, type View } from '@planner-core/adapters/canvas';
import { chooseZoom, groupTransform, metresPerPixel, offsetLatLng, planToGround, shiftAnchor, toPixel, visibleTiles } from '../src/map/mercator';

const BRISBANE = { lat: -27.4698, lng: 153.0251 };
const view = (scale = 20, offsetX = 400, offsetY = 300): View => ({ scale, offsetX, offsetY }) as View;

describe('web-mercator maths', () => {
  it('zoom 0 is one tile; the equator is 156543 m per pixel; Brisbane is about 0.887 of that', () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metresPerPixel(17, BRISBANE.lat)).toBeCloseTo(1.0597, 3);
    expect(toPixel({ lat: 0, lng: 0 }, 0)).toEqual({ x: 128, y: 128 });
    expect(toPixel({ lat: 0, lng: -180 }, 3).x).toBeCloseTo(0, 6);
  });

  it('north is where the north arrow says: 0 = plan up; 90 = plan right; east is a quarter turn clockwise from north', () => {
    const up = planToGround({ x: 0, y: 1 }, 0);
    expect(up.north).toBeCloseTo(1, 9); expect(up.east).toBeCloseTo(0, 9);
    const right90 = planToGround({ x: 1, y: 0 }, 90); // north is to the right, so plan-right is north
    expect(right90.north).toBeCloseTo(1, 9); expect(right90.east).toBeCloseTo(0, 9);
    const down90 = planToGround({ x: 0, y: -1 }, 90); // plan-down is east when north is to the right
    expect(down90.east).toBeCloseTo(1, 9);
    expect(planToGround({ x: 1, y: 0 }, 0).east).toBeCloseTo(1, 9);
  });

  it('100 m north is 0.0009 degrees of latitude; 100 m east is wider in degrees away from the equator', () => {
    expect(offsetLatLng(BRISBANE, 0, 100).lat - BRISBANE.lat).toBeCloseTo(100 / 111320, 7);
    expect(offsetLatLng(BRISBANE, 100, 0).lng - BRISBANE.lng).toBeCloseTo(100 / (111320 * Math.cos((BRISBANE.lat * Math.PI) / 180)), 7);
  });

  it('dragging the map moves the anchor the opposite way (the map follows the pointer), and dragging back restores it', () => {
    const moved = shiftAnchor(BRISBANE, 0, { x: 0, y: 10 }); // content dragged 10 m up the plan
    expect(moved.lat).toBeLessThan(BRISBANE.lat); // what is at the origin is now 10 m SOUTH of before
    const back = shiftAnchor(moved, 0, { x: 0, y: -10 });
    expect(back.lat).toBeCloseTo(BRISBANE.lat, 9);
    expect(back.lng).toBeCloseTo(BRISBANE.lng, 9);
    expect(shiftAnchor(BRISBANE, 0, { x: 5, y: 0 }).lng).toBeLessThan(BRISBANE.lng);
  });

  it('with north rotated, dragging along the plan moves the anchor along the true compass direction', () => {
    // north points to the right on the plan: dragging the map right (towards north) moves the anchor south
    const m = shiftAnchor(BRISBANE, 90, { x: 10, y: 0 });
    expect(m.lat).toBeLessThan(BRISBANE.lat);
    expect(m.lng).toBeCloseTo(BRISBANE.lng, 9);
  });

  it('one plan metre is the right number of screen pixels on the map, at every zoom', () => {
    for (const z of [15, 17, 19]) {
      const t = groupTransform(view(20), 0, z, BRISBANE.lat);
      expect(t.scale / 20).toBeCloseTo(metresPerPixel(z, BRISBANE.lat), 12);
    }
  });

  it('chooses about one tile pixel per screen pixel, inside the provider zoom range', () => {
    expect(chooseZoom(20, BRISBANE.lat, 20)).toBe(20);
    expect(chooseZoom(20, BRISBANE.lat, 18)).toBe(18);
    expect(chooseZoom(0.5, BRISBANE.lat, 20)).toBe(16);
    expect(chooseZoom(0.001, BRISBANE.lat, 20)).toBe(7);
    expect(chooseZoom(1e-9, BRISBANE.lat, 20)).toBe(1);
  });

  it('visible tiles cover the canvas, including with a rotated north', () => {
    for (const north of [0, 37, 90, 200]) {
      const v = view(2, 400, 300);
      const z = chooseZoom(v.scale, BRISBANE.lat, 20);
      const tiles = visibleTiles(BRISBANE, north, v, 800, 600, z);
      expect(tiles.length).toBeGreaterThan(0);
      const t = groupTransform(v, north, z, BRISBANE.lat);
      const th = (north * Math.PI) / 180;
      for (const [cx, cy] of [[0, 0], [800, 0], [0, 600], [800, 600], [400, 300]]) {
        const dx = (cx - t.x) / t.scale, dy = (cy - t.y) / t.scale;
        const gx = dx * Math.cos(th) + dy * Math.sin(th), gy = -dx * Math.sin(th) + dy * Math.cos(th);
        expect(tiles.some((q) => gx >= q.px && gx < q.px + 256 && gy >= q.py && gy < q.py + 256), `north ${north} corner ${cx},${cy}`).toBe(true);
      }
    }
  });

  it('a tile is never asked for twice, indices stay inside the world, and a silly zoom is capped', () => {
    const tiles = visibleTiles(BRISBANE, 0, view(2), 800, 600, 16);
    expect(new Set(tiles.map((q) => `${q.x}/${q.y}`)).size).toBe(tiles.length);
    const n = 2 ** 16;
    expect(tiles.every((q) => q.x >= 0 && q.x < n && q.y >= 0 && q.y < n)).toBe(true);
    expect(visibleTiles(BRISBANE, 0, view(0.0000001), 800, 600, 18)).toEqual([]);
  });

  it('the anchor sits at plan (0,0): the group origin is where the plan origin is drawn', () => {
    const v = view(10, 123, 456);
    const c = worldToCanvas({ x: 0, y: 0 }, v);
    expect(groupTransform(v, 0, 17, BRISBANE.lat).x).toBe(c.x);
    expect(groupTransform(v, 0, 17, BRISBANE.lat).y).toBe(c.y);
    expect(canvasToWorld(c, v).x).toBeCloseTo(0, 9);
  });
});
