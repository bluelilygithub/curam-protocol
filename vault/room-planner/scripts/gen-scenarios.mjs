// Generates the INPUT projects in tests/scenarios/*.json. Expected results are NOT produced here:
// they are written by hand in tests/scenarios/scenarios.test.ts with the working in the *.notes.md files (C12).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'scenarios');
mkdirSync(out, { recursive: true });

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
const write = (name, data) => writeFileSync(join(out, name), JSON.stringify(sortKeys(data), null, 2) + '\n');
const deg = (d) => (d * Math.PI) / 180;

const rectVerts = (w, l) => [
  { id: 'v1', position: { x: 0, y: 0 } },
  { id: 'v2', position: { x: w, y: 0 } },
  { id: 'v3', position: { x: w, y: l } },
  { id: 'v4', position: { x: 0, y: l } },
];
const rectWalls = (t = [0.15, 0.15, 0.15, 0.15]) => [
  { id: 'w1', startVertexId: 'v1', endVertexId: 'v2', thickness: t[0] },
  { id: 'w2', startVertexId: 'v2', endVertexId: 'v3', thickness: t[1] },
  { id: 'w3', startVertexId: 'v3', endVertexId: 'v4', thickness: t[2] },
  { id: 'w4', startVertexId: 'v4', endVertexId: 'v1', thickness: t[3] },
];
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const room = (over) => {
  const r = {
    id: 'room-1', name: 'Room', floorElevation: 0, wallHeight: 2.7, ceilingHeight: 2.7,
    vertices: [], walls: [], fixtures: [], furniture: [], ...over,
  };
  r.fixtures = [...r.fixtures].sort(byId); // collections are kept sorted by id (see commands.ts)
  r.furniture = [...r.furniture].sort(byId);
  return r;
};
const project = (id, rooms, defs) => ({
  schemaVersion: 1, id, units: 'metric', rooms, furnitureDefinitions: defs, materials: [],
});
const def = (id, w, l, h, clearancePolicies) => ({
  id, name: id, category: 'test', defaultWidth: w, defaultLength: l, defaultHeight: h,
  ...(clearancePolicies ? { clearancePolicies } : {}),
});
const item = (id, definitionId, x, y, rotation, w, l, h, elevation = 0) => ({
  id, definitionId, roomId: 'room-1', position: { x, y }, elevation, rotation, width: w, length: l, height: h,
});

// ---- rect-room-basic
write('rect-room-basic.json', project('rect-room-basic', [room({
  vertices: rectVerts(4, 5),
  walls: rectWalls([0.15, 0.2, 0.15, 0.1]),
  fixtures: [
    { id: 'door-1', type: 'door', wallId: 'w1', offsetAlongWall: 0.9, width: 0.9, height: 2.1, elevation: 0, hingeSide: 'left', swingAngle: Math.PI / 2 },
    { id: 'win-1', type: 'window', wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9 },
  ],
  furniture: [
    item('coffee-1', 'coffee', 2, 2.9, 0, 1.1, 0.6, 0.42),
    item('sofa-1', 'sofa', 2, 4.4, Math.PI, 2, 0.9, 0.85),
  ],
})], [def('sofa', 2, 0.9, 0.85, [{ side: 'front', offset: 0.45, severity: 'soft' }]), def('coffee', 1.1, 0.6, 0.42)]));

// ---- concave-invalid (L-shaped; notch [3,6]x[3,6] removed)
write('concave-invalid.json', project('concave-invalid', [room({
  vertices: [
    { id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 6, y: 0 } }, { id: 'c', position: { x: 6, y: 3 } },
    { id: 'd', position: { x: 3, y: 3 } }, { id: 'e', position: { x: 3, y: 6 } }, { id: 'f', position: { x: 0, y: 6 } },
  ],
  walls: [
    { id: 'wall-ab', startVertexId: 'a', endVertexId: 'b', thickness: 0.15 },
    { id: 'wall-bc', startVertexId: 'b', endVertexId: 'c', thickness: 0.15 },
    { id: 'wall-cd', startVertexId: 'c', endVertexId: 'd', thickness: 0.15 },
    { id: 'wall-de', startVertexId: 'd', endVertexId: 'e', thickness: 0.15 },
    { id: 'wall-ef', startVertexId: 'e', endVertexId: 'f', thickness: 0.15 },
    { id: 'wall-fa', startVertexId: 'f', endVertexId: 'a', thickness: 0.15 },
  ],
  // 37 degrees, quantized to 0.1 degree is exact
  furniture: [item('sofa-1', 'sofa', 2.4, 2.4, deg(37), 2, 0.9, 0.85)],
})], [def('sofa', 2, 0.9, 0.85)]));

// ---- door-swing-edge
write('door-swing-edge.json', project('door-swing-edge', [room({
  vertices: rectVerts(4, 5),
  walls: rectWalls(),
  fixtures: [
    { id: 'door-1', type: 'door', wallId: 'w1', offsetAlongWall: 2, width: 0.9, height: 2.1, elevation: 0, hingeSide: 'left', swingAngle: deg(75), accessZoneDepth: 0.3 },
    { id: 'door-2', type: 'door', wallId: 'w1', offsetAlongWall: 1, width: 0.8, height: 2.1, elevation: 0, hingeSide: 'right', swingAngle: Math.PI / 2, accessZoneDepth: 0.3 },
  ],
  furniture: [
    item('chair-a', 'chair', 2.65, 0.2, 0, 0.4, 0.4, 0.9),
    item('chair-b', 'chair-small', 2, 0.25, 0, 0.2, 0.2, 0.9),
  ],
})], [def('chair', 0.4, 0.4, 0.9), def('chair-small', 0.2, 0.2, 0.9)]));

// ---- clearance-matrix (6 x 6)
const hardFront = [{ side: 'front', offset: 0.75, severity: 'hard' }];
write('clearance-matrix.json', project('clearance-matrix', [room({
  vertices: rectVerts(6, 6),
  walls: rectWalls(),
  furniture: [
    item('sofa-1', 'sofa', 4.5, 1.0, 0, 2, 0.9, 0.85), // (a) chair-1 sits in its front zone
    item('chair-1', 'chair', 4.5, 1.8, 0, 0.5, 0.5, 0.9),
    item('sofa-2', 'sofa', 1.5, 5.4, 0, 2, 0.9, 0.85), // (b) zone leaves the room: exempt
    item('sofa-3', 'sofa', 1.5, 1.0, 0, 2, 0.9, 0.85), // (c) zones overlap, footprints only touch
    item('sofa-4', 'sofa', 1.5, 2.65, Math.PI, 2, 0.9, 0.85),
    item('sofa-5', 'sofa', 5.0, 4.5, Math.PI / 2, 2, 0.9, 0.85), // (d) rotated 90 degrees: front faces -x
    item('chair-2', 'chair', 4.2, 4.5, 0, 0.5, 0.5, 0.9),
    item('chair-3', 'chair', 5.7, 4.5, 0, 0.4, 0.4, 0.9),
    item('chair-4', 'chair', 5.0, 5.75, 0, 0.4, 0.4, 0.9),
  ],
})], [def('sofa', 2, 0.9, 0.85, hardFront), def('chair', 0.5, 0.5, 0.9)]));

// ---- wall-edit-cascade: before project + the EditWall command that pulls the north wall in by 0.8 m
const cascadeRoom = room({
  vertices: rectVerts(4, 5),
  walls: rectWalls(),
  fixtures: [
    { id: 'win-n', type: 'window', wallId: 'w3', offsetAlongWall: 2, width: 1.2, height: 1.2, elevation: 0.9 },
    { id: 'win-e', type: 'window', wallId: 'w2', offsetAlongWall: 4.5, width: 0.8, height: 1.2, elevation: 0.9 },
  ],
  furniture: [
    item('sofa-1', 'sofa', 2, 4.5, 0, 2, 0.9, 0.85),
    item('table-1', 'table', 3.5, 3.9, 0, 1, 0.6, 0.75),
    item('chair-1', 'chair', 3.5, 4.6, 0, 0.5, 0.5, 0.9),
    item('shelf-1', 'shelf', 2, 1, 0, 0.9, 0.35, 1.8),
  ],
});
const cascadeDefs = [def('sofa', 2, 0.9, 0.85), def('table', 1, 0.6, 0.75), def('chair', 0.5, 0.5, 0.9), def('shelf', 0.9, 0.35, 1.8)];
write('wall-edit-cascade.json', project('wall-edit-cascade', [cascadeRoom], cascadeDefs));
const movedVerts = cascadeRoom.vertices.map((v) => (v.id === 'v3' ? { ...v, position: { x: 4, y: 4.2 } } : v.id === 'v4' ? { ...v, position: { x: 0, y: 4.2 } } : v));
write('wall-edit-cascade.command.json', {
  type: 'EditWall', roomId: 'room-1',
  from: { vertices: cascadeRoom.vertices, walls: cascadeRoom.walls, fixtures: cascadeRoom.fixtures },
  // win-e is clamped by the interaction layer: new east wall length 4.2, centre range [0.45, 3.75] -> 3.75
  to: {
    vertices: movedVerts, walls: cascadeRoom.walls,
    fixtures: cascadeRoom.fixtures.map((f) => (f.id === 'win-e' ? { ...f, offsetAlongWall: 3.75 } : f)),
  },
});

// ---- quantize-edge: raw (unquantized) proposals + the project they are proposed into
write('quantize-edge.json', {
  project: project('quantize-edge', [room({ vertices: rectVerts(4, 5), walls: rectWalls() })], [def('chair', 0.5, 0.5, 0.9)]),
  proposals: [
    { id: 'edge-ok', x: 0.2504, y: 2.5, elevation: 0.0004 },
    { id: 'edge-mid', x: 0.2496, y: 1.5, elevation: 0.0005 },
    { id: 'edge-out', x: 0.2494, y: 3.5, elevation: 0.0006 },
  ],
});

// ---- perf-100: 100 instances in a large L-shaped room, mixed rotations/elevations, all valid
const lverts = [
  [0, 0], [20, 0], [20, 12], [12, 12], [12, 20], [0, 20],
].map(([x, y], i) => ({ id: `p${i + 1}`, position: { x, y } }));
const lwalls = lverts.map((v, i) => ({ id: `pw${i + 1}`, startVertexId: v.id, endVertexId: lverts[(i + 1) % lverts.length].id, thickness: 0.15 }));
const perfItems = [];
for (let j = 0; j < 12 && perfItems.length < 100; j++) {
  for (let i = 0; i < 12 && perfItems.length < 100; i++) {
    const x = Math.round((1 + 1.6 * i) * 1000) / 1000;
    const y = Math.round((1 + 1.6 * j) * 1000) / 1000;
    if (x + 0.7 > 12 && y + 0.7 > 12) continue; // notch
    const n = perfItems.length;
    perfItems.push(item(`f${String(n).padStart(3, '0')}`, 'box', x, y, deg((n % 6) * 15), 1, 0.8, 0.8, n % 7 === 0 ? 0.5 : 0));
  }
}
write('perf-100.json', project('perf-100', [room({ vertices: lverts, walls: lwalls, furniture: perfItems })], [def('box', 1, 0.8, 0.8)]));
console.log('wrote scenarios to', out, '— perf items:', perfItems.length);
