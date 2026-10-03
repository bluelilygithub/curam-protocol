// Axis mapping (Test Plan M4): domain → three → domain is exact, and the 3D rotation convention agrees with the engine's
// object frame (C20) for every rotation, so a model drawn in 3D occupies exactly the footprint the engine validates.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { footprintCorners, localToWorld } from '../../src/engine';
import { instanceTransform, localToThreeWorld, planToThree, rotationFromY, rotationYOf, threeToPlan } from '../../src/render3d/transforms';
import { furnitureParts } from '../../src/render3d/furnitureParts';
import { prism, wallPieces } from '../../src/render3d/wallPieces';
import { makeDoor, makeRoom } from '../helpers';

const RUNS = { numRuns: 300, seed: 20261004 };
const coord = fc.double({ min: -50, max: 50, noNaN: true });

describe('axis mapping', () => {
  it('threeToPlan(planToThree(p, e)) = (p, e) for any point and elevation', () => {
    fc.assert(fc.property(coord, coord, fc.double({ min: -2, max: 10, noNaN: true }), (x, y, e) => {
      const back = threeToPlan(planToThree({ x, y }, e));
      return back.position.x === x && back.position.y === y && back.elevation === e;
    }), RUNS);
  });

  it('World X → Three X, World Y → Three Z, elevation → Three Y (fixed example)', () => {
    expect(planToThree({ x: 1.5, y: 2.5 }, 0.75)).toEqual([1.5, 0.75, 2.5]);
  });

  it('rotationFromY inverts rotationYOf and never yields −0', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 6.28, noNaN: true }), (phi) => rotationFromY(rotationYOf(phi)) === phi));
    expect(Object.is(rotationYOf(0), 0)).toBe(true);
  });

  it('a local point lands exactly where the engine puts it, for any rotation (the 3D turn is −φ)', () => {
    fc.assert(fc.property(
      coord, coord, fc.double({ min: 0, max: 6.28, noNaN: true }),
      fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: 0, max: 3, noNaN: true }),
      (px, py, rot, lx, ly, ly3) => {
        const rect = { position: { x: px, y: py }, width: 1, length: 1, rotation: rot };
        const eng = localToWorld(rect, { x: lx, y: ly });
        const t = instanceTransform({ position: rect.position, elevation: 0.2, rotation: rot });
        const w = localToThreeWorld(t.position, t.rotationY, [lx, ly3, ly]);
        return Math.abs(w[0] - eng.x) < 1e-9 && Math.abs(w[2] - eng.y) < 1e-9 && Math.abs(w[1] - (0.2 + ly3)) < 1e-12;
      },
    ), RUNS);
  });

  it('the model of any library-sized instance stays inside the engine footprint at any rotation', () => {
    fc.assert(fc.property(coord, coord, fc.double({ min: 0, max: 6.28, noNaN: true }), (px, py, rot) => {
      const w = 1.4, l = 0.7, h = 0.74;
      const rect = { position: { x: px, y: py }, width: w, length: l, rotation: rot };
      const corners = footprintCorners(rect);
      const t = instanceTransform({ position: rect.position, elevation: 0, rotation: rot });
      for (const part of furnitureParts('desk', w, l, h)) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const p = localToThreeWorld(t.position, t.rotationY, [part.centre[0] + (sx * part.size[0]) / 2, 0, part.centre[2] + (sz * part.size[2]) / 2]);
          // The point must lie inside the footprint (inclusive).
          const inside = corners.every((c, i) => {
            const n = corners[(i + 1) % 4];
            return (n.x - c.x) * (p[2] - c.y) - (n.y - c.y) * (p[0] - c.x) >= -1e-9;
          });
          if (!inside) return false;
        }
      }
      return true;
    }), { ...RUNS, numRuns: 100 });
  });
});

describe('wall pieces under random doors', () => {
  it('opening volume is exactly width × thickness × height wherever the door sits', () => {
    fc.assert(fc.property(fc.double({ min: 0.5, max: 3.45, noNaN: true }), fc.double({ min: 0.6, max: 1.0, noNaN: true }), (offset, width) => {
      const room = makeRoom({ fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: offset, width, height: 2.04 })] });
      const total = wallPieces(room).reduce((s, p) => {
        const m = prism(p.polygon, p.y0, p.y1);
        let v = 0;
        for (let i = 0; i < m.indices.length; i += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => { const o = m.indices[i + k] * 3; return [m.positions[o], m.positions[o + 1], m.positions[o + 2]]; });
          v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        }
        return s + v;
      }, 0);
      return Math.abs(total - (7.533 - width * 0.15 * 2.04)) < 1e-6;
    }), RUNS);
  });
});
