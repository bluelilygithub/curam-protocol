// M4 pure 3D geometry: wall pieces, furniture/fixture models, wall fade, camera presets, saved views.
// Expectations are hand-derived (C12); see tests/scenarios/NOTES.md "3D geometry (M4)".
import { describe, expect, it } from 'vitest';
import {
  addSavedView, cleanViewName, deleteSavedView, deserializeProject, nextViewName, renameSavedView, savedViewsOf, serializeProject,
  type Fixture, type Project, type Room,
} from '../../src/engine';
import { FURNITURE_LIBRARY } from '../../src/data/furnitureLibrary';
import {
  clipBand, pieceVolume, polygonArea, prism, wallPieces, type WallPiece,
} from '../../src/render3d/wallPieces';
import { furnitureParts, hasFurnitureRecipe, partsBounds } from '../../src/render3d/furnitureParts';
import { fixtureModel } from '../../src/render3d/fixtureParts';
import { localToThreeWorld } from '../../src/render3d/transforms';
import { FADE_MIN_POLAR, wallsToFade } from '../../src/render3d/wallFade';
import { fitDistance, orthoZoomFor, polarFromVertical, presetCamera, roomBounds, type CameraState } from '../../src/render3d/cameraPresets';
import { makeDoor, makeProject, makeRoom, rectVertices, ringWalls } from '../helpers';

const window1 = (over: Partial<Fixture> & { id: string }): Fixture => ({
  type: 'window', wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9, ...over,
});
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const volume = (ps: WallPiece[]): number => sum(ps.map(pieceVolume));

describe('wall pieces', () => {
  // 4 × 5 room, walls 0.15 thick, height 2.7. The mitred outer rectangle is 4.3 × 5.3, so the wall ring area is
  // 4.3 × 5.3 − 4 × 5 = 22.79 − 20 = 2.79 m² and its volume 2.79 × 2.7 = 7.533 m³.
  const RING_VOLUME = 7.533;

  it('a room without openings is four full-height pieces tiling the ring', () => {
    const ps = wallPieces(makeRoom());
    expect(ps).toHaveLength(4);
    expect(ps.every((p) => p.kind === 'full' && p.y0 === 0 && p.y1 === 2.7)).toBe(true);
    expect(volume(ps)).toBeCloseTo(RING_VOLUME, 9);
  });

  it('keeps the mitred outer corners whole: the bottom wall reaches x = −0.15 and 4.15', () => {
    const w1 = wallPieces(makeRoom()).find((p) => p.wallId === 'w1')!;
    const xs = w1.polygon.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-0.15, 12);
    expect(Math.max(...xs)).toBeCloseTo(4.15, 12);
  });

  it('a door (0.9 × 2.04 at offset 1 on w1) leaves full | above-head | full; opening volume 0.9 × 0.15 × 2.04 = 0.2754 is removed', () => {
    const room = makeRoom({ fixtures: [makeDoor({ id: 'd', offsetAlongWall: 1, width: 0.9, height: 2.04 })] });
    const w1 = wallPieces(room).filter((p) => p.wallId === 'w1');
    expect(w1.map((p) => p.kind)).toEqual(['full', 'above', 'full']);
    const above = w1[1];
    expect(above.y0).toBeCloseTo(2.04, 12);
    expect(above.y1).toBeCloseTo(2.7, 12);
    expect(above.fixtureId).toBe('d');
    expect(volume(wallPieces(room))).toBeCloseTo(RING_VOLUME - 0.2754, 9);
  });

  it('a window (1.2 × 1.2, sill 0.9 on w2) leaves below-sill and above-head pieces; opening volume 1.2 × 0.15 × 1.2 = 0.216', () => {
    const room = makeRoom({ fixtures: [window1({ id: 'win' })] });
    const w2 = wallPieces(room).filter((p) => p.wallId === 'w2');
    expect(w2.map((p) => p.kind)).toEqual(['full', 'below', 'above', 'full']);
    const below = w2[1];
    const above = w2[2];
    expect([below.y0, below.y1]).toEqual([0, 0.9]);
    expect(above.y0).toBeCloseTo(2.1, 12);
    expect(above.y1).toBeCloseTo(2.7, 12);
    expect(volume(wallPieces(room))).toBeCloseTo(RING_VOLUME - 0.216, 9);
  });

  it('two openings on one wall (door 0.55..1.45, window 1.9..3.1 on a 4 m wall) give six pieces', () => {
    const room = makeRoom({
      fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1, width: 0.9, height: 2.04 }), window1({ id: 'win', wallId: 'w1' })],
    });
    const w1 = wallPieces(room).filter((p) => p.wallId === 'w1');
    expect(w1.map((p) => p.kind)).toEqual(['full', 'above', 'full', 'below', 'above', 'full']);
    expect(volume(wallPieces(room))).toBeCloseTo(RING_VOLUME - 0.2754 - 0.216, 9);
  });

  it('pieces are disjoint: at any height the plan areas of the pieces covering it sum to the wall ring minus the openings there', () => {
    const room = makeRoom({
      fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1, width: 0.9, height: 2.04 }), window1({ id: 'win', wallId: 'w1' })],
    });
    const ps = wallPieces(room);
    const ringArea = 2.79;
    // y = 0.5: door open (0.9 × 0.15 removed); window sill is 0.9 so it is solid.
    expect(sum(ps.filter((p) => p.y0 <= 0.5 && p.y1 >= 0.5).map((p) => Math.abs(polygonArea(p.polygon))))).toBeCloseTo(ringArea - 0.135, 9);
    // y = 1.5: door open and window open.
    expect(sum(ps.filter((p) => p.y0 <= 1.5 && p.y1 >= 1.5).map((p) => Math.abs(polygonArea(p.polygon))))).toBeCloseTo(ringArea - 0.135 - 0.18, 9);
    // y = 2.4: above both openings, fully solid.
    expect(sum(ps.filter((p) => p.y0 <= 2.4 && p.y1 >= 2.4).map((p) => Math.abs(polygonArea(p.polygon))))).toBeCloseTo(ringArea, 9);
  });

  it('thick walls and an L-room (mitres at a reflex corner) still tile: ring area equals the sum of piece areas', () => {
    const vs = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]].map(([x, y], i) => ({ id: `v${i + 1}`, position: { x, y } }));
    const room = makeRoom({ vertices: vs, walls: ringWalls(vs, 'w', 0.3) });
    const total = sum(wallPieces(room).map((p) => Math.abs(polygonArea(p.polygon))));
    // Outer boundary of the L offset by 0.3 outward with mitred corners: perimeter × 0.3 + 5 convex corners × 0.09 − 1 reflex × 0.09
    // (each convex mitre adds t², the reflex corner removes t²) = 24 × 0.3 + 0.09 × (5 − 1) = 7.56.
    expect(total).toBeCloseTo(7.56, 9);
  });

  it('an opening is cut perpendicular to the wall: every piece edge across the wall is perpendicular to it', () => {
    const room = makeRoom({ fixtures: [window1({ id: 'win', wallId: 'w1', offsetAlongWall: 2 })] });
    const mid = wallPieces(room).filter((p) => p.wallId === 'w1' && p.kind === 'below')[0];
    const xs = [...new Set(mid.polygon.map((p) => Math.round(p.x * 1e9) / 1e9))].sort((a, b) => a - b);
    expect(xs).toEqual([1.4, 2.6]); // 2 ± 0.6 on the interior face, same x on the outer face
  });

  it('is deterministic', () => {
    const room = makeRoom({ fixtures: [window1({ id: 'win' })] });
    expect(JSON.stringify(wallPieces(room))).toBe(JSON.stringify(wallPieces(room)));
  });

  it('clipBand keeps the middle of a unit square and returns nothing outside it', () => {
    const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(polygonArea(clipBand(sq, { x: 0, y: 0 }, { x: 1, y: 0 }, 0.25, 0.75))).toBeCloseTo(0.5, 12);
    expect(clipBand(sq, { x: 0, y: 0 }, { x: 1, y: 0 }, 2, 3).length).toBeLessThan(3);
  });
});

describe('prism mesh', () => {
  const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }];
  const m = prism(square, 0.5, 2.5);

  it('has 12 triangles for a quad and unit-length normals', () => {
    expect(m.indices.length / 3).toBe(12);
    for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1, 12);
  });

  it('encloses the right volume with outward winding (signed volume 2 × 1 × 2 = 4)', () => {
    let v = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => { const o = m.indices[i + k] * 3; return [m.positions[o], m.positions[o + 1], m.positions[o + 2]]; });
      v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    expect(v).toBeCloseTo(4, 12);
  });

  it('every face normal points away from the centre', () => {
    const centre = [1, 1.5, 0.5];
    for (let i = 0; i < m.positions.length; i += 3) {
      const d = [m.positions[i] - centre[0], m.positions[i + 1] - centre[1], m.positions[i + 2] - centre[2]];
      expect(d[0] * m.normals[i] + d[1] * m.normals[i + 1] + d[2] * m.normals[i + 2]).toBeGreaterThan(0);
    }
  });
});

describe('furniture models', () => {
  const EPS = 1e-9;
  it('every library item has a recipe', () => {
    for (const d of FURNITURE_LIBRARY) expect(hasFurnitureRecipe(d.id), d.id).toBe(true);
  });

  it('every recipe fills exactly its width × length × height envelope, at default and other sizes', () => {
    for (const d of FURNITURE_LIBRARY) {
      for (const [sw, sl, sh] of [[1, 1, 1], [1.5, 0.8, 1.2], [0.7, 1.3, 0.9]]) {
        const w = d.defaultWidth * sw, l = d.defaultLength * sl, h = d.defaultHeight * sh;
        const parts = furnitureParts(d.id, w, l, h);
        const b = partsBounds(parts);
        expect(b.min[0], d.id).toBeCloseTo(-w / 2, 9);
        expect(b.max[0], d.id).toBeCloseTo(w / 2, 9);
        expect(b.min[1], d.id).toBeCloseTo(0, 9);
        expect(b.max[1], d.id).toBeCloseTo(h, 9);
        expect(b.min[2], d.id).toBeCloseTo(-l / 2, 9);
        expect(b.max[2], d.id).toBeCloseTo(l / 2, 9);
        for (const p of parts) for (const s of p.size) expect(s, `${d.id} ${p.role}`).toBeGreaterThan(EPS);
      }
    }
  });

  it('puts the back at −z and the front at +z (C20): a sofa backrest sits against −z', () => {
    const parts = furnitureParts('sofa-3', 2.2, 0.95, 0.85);
    const tall = parts.filter((p) => p.centre[1] + p.size[1] / 2 > 0.85 - EPS);
    expect(tall.length).toBeGreaterThan(0);
    for (const p of tall) expect(p.centre[2]).toBeLessThan(0);
  });

  it('an unknown definition is one box of the full size', () => {
    const parts = furnitureParts('mystery', 1, 2, 3);
    expect(parts).toHaveLength(1);
    expect(parts[0].size).toEqual([1, 3, 2]);
    expect(parts[0].centre).toEqual([0, 1.5, 0]);
  });
});

describe('fixture models', () => {
  it('a window on the right wall is centred in the wall thickness, outside the room, with glass', () => {
    const room = makeRoom({ fixtures: [window1({ id: 'win' })] });
    const m = fixtureModel(room, room.fixtures[0])!;
    expect(m.position).toEqual([4, 0, 2.5]);
    expect(m.rotationY).toBeCloseTo(-Math.PI / 2, 12);
    const glass = m.parts.find((p) => p.role === 'glass')!;
    expect(glass).toBeDefined();
    // Local (0, 1.5, −0.075) is the middle of the 0.15 thick wall: three x = 4 + 0.075.
    const w = localToThreeWorld(m.position, m.rotationY, glass.centre);
    expect(w[0]).toBeCloseTo(4.075, 12);
    expect(w[1]).toBeCloseTo(1.5, 12);
    expect(w[2]).toBeCloseTo(2.5, 12);
    const ys = m.parts.flatMap((p) => [p.centre[1] - p.size[1] / 2, p.centre[1] + p.size[1] / 2]);
    expect(Math.min(...ys)).toBeCloseTo(0.9, 12);
    expect(Math.max(...ys)).toBeCloseTo(2.1, 12);
  });

  it('a door has a leaf and no glass, reaching the floor', () => {
    const room = makeRoom({ fixtures: [makeDoor({ id: 'd', offsetAlongWall: 1, width: 0.9, height: 2.04 })] });
    const m = fixtureModel(room, room.fixtures[0])!;
    expect(m.parts.some((p) => p.role === 'door')).toBe(true);
    expect(m.parts.some((p) => p.role === 'glass')).toBe(false);
    const ys = m.parts.flatMap((p) => [p.centre[1] - p.size[1] / 2, p.centre[1] + p.size[1] / 2]);
    expect(Math.min(...ys)).toBeCloseTo(0, 12);
    expect(Math.max(...ys)).toBeCloseTo(2.04, 12);
    expect(m.rotationY).toBeCloseTo(0, 12); // w1 runs along +x
  });

  it('is undefined for a fixture whose wall is missing', () => {
    const room = makeRoom();
    expect(fixtureModel(room, makeDoor({ id: 'x', wallId: 'nope' }))).toBeUndefined();
  });
});

describe('wall fading', () => {
  const room = makeRoom(); // 4 × 5, centre (2, 2.5)
  // A wall fades when the camera is on the outer side of its inside face. Camera (9, −5): below w1 (y = 0, inside is +y) and to the
  // right of w2 (x = 4, inside is −x); above w3's inside (y = 5) and right of w4's (x = 0) → w1 and w2 only.
  it('from the south-east, the two walls whose outside faces the camera fade', () => {
    expect(wallsToFade(room, { x: 9, y: -5 }, Math.PI / 4)).toEqual(['w1', 'w2']);
  });
  // Camera (9, 10): right of w2 (outside), above w3 (y > 5 → outside); w1 (y = 0) and w4 (x = 0) see it from the inside.
  it('from the north-east, w2 and w3 fade — including a wall that hides furniture standing close behind it', () => {
    expect(wallsToFade(room, { x: 9, y: 10 }, Math.PI / 4)).toEqual(['w2', 'w3']);
  });
  // Camera on the room's side of every wall's inside face (just inside a corner): nothing hides anything.
  it('a camera over the room fades nothing', () => {
    expect(wallsToFade(room, { x: 3.9, y: 4.9 }, Math.PI / 4)).toEqual([]);
  });
  // L-room (0,0)(6,0)(6,3)(3,3)(3,6)(0,6), walls w1..w6 in order. Camera (9, 9): w2 (x = 6, inside −x), w3 (y = 3, inside −y),
  // w4 (x = 3, inside −x) and w5 (y = 6, inside −y) all have the camera on their outer side; w1 (y = 0, inside +y) and
  // w6 (x = 0, inside +x) see it from the inside.
  it('in a notched room every wall whose outside faces the camera fades, including the notch walls', () => {
    const vs = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]].map(([x, y], i) => ({ id: `v${i + 1}`, position: { x, y } }));
    const l = makeRoom({ vertices: vs, walls: ringWalls(vs) });
    expect(wallsToFade(l, { x: 9, y: 9 }, Math.PI / 4)).toEqual(['w2', 'w3', 'w4', 'w5']);
  });
  it('from directly in front of one wall only that wall fades', () => {
    expect(wallsToFade(room, { x: 2, y: -8 }, Math.PI / 3)).toEqual(['w1']);
  });
  it('nothing fades when looking (nearly) straight down', () => {
    expect(wallsToFade(room, { x: 9, y: -5 }, FADE_MIN_POLAR - 0.01)).toEqual([]);
    expect(wallsToFade(room, { x: 9, y: -5 }, 0)).toEqual([]);
  });
  it('a camera above a wall does not fade that wall', () => {
    expect(wallsToFade(room, { x: 2, y: -0.05 }, Math.PI / 3)).not.toContain('w1');
  });
  it('a camera inside the room fades nothing', () => {
    expect(wallsToFade(room, { x: 1, y: 1 }, Math.PI / 3)).toEqual([]);
  });
});

describe('camera presets', () => {
  const room = makeRoom();
  it('roomBounds: 4 × 5 × 2.7 → centre (2, 1.35, 2.5), radius = half the diagonal', () => {
    const b = roomBounds(room);
    expect(b.centre).toEqual([2, 1.35, 2.5]);
    expect(b.radius).toBeCloseTo(Math.hypot(4, 5, 2.7) / 2, 12);
  });
  it('isometric looks from +x, +y (up), +z toward the centre, equal on all axes', () => {
    const c = presetCamera(room, 'iso', null);
    const d = [c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]];
    expect(d[0]).toBeCloseTo(d[1], 12);
    expect(d[1]).toBeCloseTo(d[2], 12);
    expect(d[0]).toBeGreaterThan(0);
    expect(c.projection).toBe('perspective');
  });
  it('top looks straight down (within a hair) from above the centre', () => {
    const c = presetCamera(room, 'top', null);
    expect(c.position[0]).toBeCloseTo(2, 6);
    expect(polarFromVertical(c.position, c.target)).toBeLessThan(0.002);
    expect(polarFromVertical(c.position, c.target)).toBeLessThan(FADE_MIN_POLAR);
  });
  it('fit keeps the current direction and re-frames the distance', () => {
    const cur: CameraState = { position: [2, 11.35, 12.5], target: [2, 1.35, 2.5], projection: 'perspective', zoom: 1 };
    const c = presetCamera(room, 'fit', cur);
    const a = [cur.position[0] - cur.target[0], cur.position[1] - cur.target[1], cur.position[2] - cur.target[2]];
    const b = [c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]];
    const la = Math.hypot(...a), lb = Math.hypot(...b);
    for (let i = 0; i < 3; i++) expect(b[i] / lb).toBeCloseTo(a[i] / la, 12);
  });
  it('a bigger room is framed from farther away, and a wider window needs less distance', () => {
    const big = makeRoom({ vertices: rectVertices(12, 10), walls: ringWalls(rectVertices(12, 10)) });
    expect(fitDistance(roomBounds(big).radius)).toBeGreaterThan(fitDistance(roomBounds(room).radius));
    expect(fitDistance(5, 45, 2)).toBeLessThanOrEqual(fitDistance(5, 45, 1));
  });
  it('orthographic zoom grows with the viewport and shrinks for bigger rooms', () => {
    expect(orthoZoomFor(room, 2000, 1400)).toBeGreaterThan(orthoZoomFor(room, 1000, 700));
    const big = makeRoom({ vertices: rectVertices(12, 10), walls: ringWalls(rectVertices(12, 10)) });
    expect(orthoZoomFor(big, 1000, 700)).toBeLessThan(orthoZoomFor(room, 1000, 700));
  });
  it('keeps the requested projection', () => {
    expect(presetCamera(room, 'iso', null, { projection: 'orthographic' }).projection).toBe('orthographic');
  });
  it('polarFromVertical: straight down 0, horizontal π/2', () => {
    expect(polarFromVertical([0, 5, 0], [0, 0, 0])).toBeCloseTo(0, 12);
    expect(polarFromVertical([5, 0, 0], [0, 0, 0])).toBeCloseTo(Math.PI / 2, 12);
    expect(polarFromVertical([1, 1, 1], [1, 1, 1])).toBe(0);
  });
});

describe('saved views', () => {
  const base: Project = makeProject();
  const v = { id: 'sv1', cameraPosition: [10.0004, 10, 10] as [number, number, number], target: [2, 1, 2.5] as [number, number, number], projection: 'perspective' as const };

  it('adds in creation order with automatic names and 1 mm quantisation; the input project is not mutated', () => {
    const a = addSavedView(base, v);
    const b = addSavedView(a, { ...v, id: 'sv2' });
    expect(base.savedViews).toBeUndefined();
    expect(savedViewsOf(b).map((x) => [x.id, x.name])).toEqual([['sv1', 'View 1'], ['sv2', 'View 2']]);
    expect(savedViewsOf(a)[0].cameraPosition).toEqual([10, 10, 10]);
  });
  it('renames (trimmed, collapsed spaces, limited to 60 characters; blank keeps the old name) and deletes', () => {
    let p = addSavedView(base, v);
    p = renameSavedView(p, 'sv1', '  Living   room  ');
    expect(savedViewsOf(p)[0].name).toBe('Living room');
    expect(renameSavedView(p, 'sv1', '   ')).toEqual(p);
    expect(cleanViewName('x'.repeat(100), 'f')).toHaveLength(60);
    expect(renameSavedView(p, 'zzz', 'a')).toBe(p);
    const d = deleteSavedView(p, 'sv1');
    expect(savedViewsOf(d)).toEqual([]);
    expect(deleteSavedView(d, 'sv1')).toBe(d);
  });
  it('the next free default name skips names in use', () => {
    let p = addSavedView(base, v);
    p = renameSavedView(p, 'sv1', 'View 2');
    expect(nextViewName(p)).toBe('View 1');
  });
  it('survives a save and reload, and old projects without the field still load', () => {
    const p = addSavedView(base, { ...v, zoom: 42.12345 });
    const back = deserializeProject(serializeProject(p));
    expect(savedViewsOf(back)).toEqual(savedViewsOf(p));
    expect(savedViewsOf(back)[0].zoom).toBe(42.123);
    expect(savedViewsOf(deserializeProject(serializeProject(base)))).toEqual([]);
  });
  it('does not touch rooms', () => {
    expect(addSavedView(base, v).rooms).toBe(base.rooms);
  });
});

// Helper type check: a Room type is accepted by the pure modules.
export type _Room = Room;
