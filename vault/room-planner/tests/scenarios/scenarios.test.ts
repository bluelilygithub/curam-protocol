// Canonical scenarios (Test Plan §2). Expected results are derived by hand — see the matching *.notes.md for the
// working — and are never produced by running the engine (C12).
import { describe, expect, it } from 'vitest';
import {
  apply, deserializeProject, inverse, proposePlaceFurniture, serializeProject, validateRoom,
} from '../../src/engine';
import type { Command, Project } from '../../src/engine';
import { expectProjectEqual, expectViolations, hashProject, loadScenario, readScenarioText } from '../helpers';

const scenarios = [
  'rect-room-basic.json', 'concave-invalid.json', 'door-swing-edge.json', 'clearance-matrix.json',
  'wall-edit-cascade.json', 'perf-100.json',
];

describe('every scenario round-trips through serialize.ts', () => {
  it.each(scenarios)('%s: byte-identical (linear values exact), rotation within 1e-9', (name) => {
    const text = readScenarioText(name);
    const p = deserializeProject(text);
    expect(p.schemaVersion).toBe(1);
    expect(serializeProject(p)).toBe(text);
    expectProjectEqual(deserializeProject(serializeProject(p)), p);
  });
});

describe('rect-room-basic', () => {
  const p = loadScenario('rect-room-basic.json');
  it('4×5 room with 150/200/150/100 mm walls; sofa + coffee table, door + window: valid, zero violations', () => {
    expect(p.rooms[0].walls.map((w) => w.thickness)).toEqual([0.15, 0.2, 0.15, 0.1]);
    expect(validateRoom(p.rooms[0], p.furnitureDefinitions)).toEqual({ valid: true, violations: [] });
  });
  it('per-segment thickness does not change the interior polygon', () => {
    expect(p.rooms[0].vertices.map((v) => v.position)).toEqual([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 5 }, { x: 0, y: 5 },
    ]);
  });
});

describe('concave-invalid', () => {
  const p = loadScenario('concave-invalid.json');
  it('37° sofa crossing the notch: valid:false with exactly one hard outside_room naming the sofa', () => {
    const r = validateRoom(p.rooms[0], p.furnitureDefinitions);
    expect(r.valid).toBe(false);
    expectViolations(r.violations, [{ type: 'outside_room', severity: 'hard', objects: ['sofa-1'] }]);
  });
  it('names the wall nearest the part outside the room (d→e)', () => {
    const r = validateRoom(p.rooms[0], p.furnitureDefinitions);
    expect(r.violations[0].involvedWallIds).toContain('wall-de');
  });
});

describe('door-swing-edge', () => {
  const p = loadScenario('door-swing-edge.json');
  const r = validateRoom(p.rooms[0], p.furnitureDefinitions);
  it('chair A touching the swing apex is valid; chair B inside the swing is a hard door_swing; door-vs-door is soft only', () => {
    expect(r.valid).toBe(false);
    expectViolations(r.violations, [
      { type: 'door_swing', severity: 'hard', objects: ['chair-b'], fixtures: ['door-1'] },
      { type: 'door_swing', severity: 'soft', fixtures: ['door-1', 'door-2'] },
    ]);
  });
  it('chair A has no violation of any kind', () => {
    expect(r.violations.filter((v) => v.involvedObjectIds.includes('chair-a'))).toEqual([]);
  });
  it('removing chair B leaves only the soft door-vs-door violation (valid:true)', () => {
    const room = { ...p.rooms[0], furniture: p.rooms[0].furniture.filter((f) => f.id !== 'chair-b') };
    const after = validateRoom(room, p.furnitureDefinitions);
    expect(after.valid).toBe(true);
    expectViolations(after.violations, [{ type: 'door_swing', severity: 'soft', fixtures: ['door-1', 'door-2'] }]);
  });
});

describe('clearance-matrix', () => {
  const p = loadScenario('clearance-matrix.json');
  const r = validateRoom(p.rooms[0], p.furnitureDefinitions);
  it('(a) chair in the front zone → hard; (d) rotated sofa zone points at -x → hard; (b) and (c) → none', () => {
    expect(r.valid).toBe(false);
    expectViolations(r.violations, [
      { type: 'clearance', severity: 'hard', objects: ['sofa-1', 'chair-1'] },
      { type: 'clearance', severity: 'hard', objects: ['sofa-5', 'chair-2'] },
    ]);
  });
  it('(b) a zone leaving the room is exempt', () => {
    expect(r.violations.filter((v) => v.involvedObjectIds.includes('sofa-2'))).toEqual([]);
  });
  it('(c) overlapping zones with merely touching footprints are exempt', () => {
    expect(r.violations.filter((v) => v.involvedObjectIds.includes('sofa-3') || v.involvedObjectIds.includes('sofa-4'))).toEqual([]);
  });
  it('(d) chairs behind / beside the rotated sofa are not flagged (the zone really rotated)', () => {
    expect(r.violations.filter((v) => v.involvedObjectIds.includes('chair-3') || v.involvedObjectIds.includes('chair-4'))).toEqual([]);
  });
});

describe('wall-edit-cascade', () => {
  const before = loadScenario('wall-edit-cascade.json');
  const edit = loadScenario<Command>('wall-edit-cascade.command.json');
  const after = apply(edit, before);

  it('the room is valid before the edit', () => {
    expect(validateRoom(before.rooms[0], before.furnitureDefinitions).valid).toBe(true);
  });
  it('the edit commits (pipeline exception); exactly 2 objects are derived-invalid with outside_room', () => {
    const r = validateRoom(after.rooms[0], after.furnitureDefinitions);
    expect(r.valid).toBe(false);
    expectViolations(r.violations, [
      { type: 'outside_room', severity: 'hard', objects: ['sofa-1'] },
      { type: 'outside_room', severity: 'hard', objects: ['chair-1'] },
    ]);
    for (const v of r.violations) expect(v.involvedWallIds).toEqual(['w3']);
  });
  it('the table touching the new north wall is valid (boundary policy)', () => {
    const r = validateRoom(after.rooms[0], after.furnitureDefinitions);
    expect(r.violations.filter((v) => v.involvedObjectIds.includes('table-1'))).toEqual([]);
  });
  it('fixtures clamped per A3: east window moved to 3.75 and is valid; no fixture violations', () => {
    expect(after.rooms[0].fixtures.find((f) => f.id === 'win-e')!.offsetAlongWall).toBe(3.75);
    const r = validateRoom(after.rooms[0], after.furnitureDefinitions);
    expect(r.violations.some((v) => v.type === 'fixture_out_of_wall')).toBe(false);
  });
  it('an unclamped fixture is carried and reported as fixture_out_of_wall (derived, non-blocking)', () => {
    const unclamped: Command = {
      ...edit,
      to: { ...(edit as { to: { vertices: unknown[]; walls: unknown[]; fixtures: unknown[] } }).to, fixtures: (edit as { from: { fixtures: unknown[] } }).from.fixtures },
    } as Command;
    const s = apply(unclamped, before);
    const r = validateRoom(s.rooms[0], s.furnitureDefinitions);
    expectViolations(r.violations.filter((v) => v.type === 'fixture_out_of_wall'), [
      { type: 'fixture_out_of_wall', severity: 'hard', fixtures: ['win-e'] },
    ]);
  });
  it('inverse restores prior geometry AND validity by vertex id', () => {
    const restored: Project = apply(inverse(edit), after);
    expectProjectEqual(restored, before);
    expect(validateRoom(restored.rooms[0], restored.furnitureDefinitions).valid).toBe(true);
  });
  it('replay is deterministic: applying the same command twice gives the same hash', () => {
    expect(hashProject(apply(edit, before))).toBe(hashProject(after));
  });
});

describe('quantize-edge', () => {
  const { project, proposals } = loadScenario<{
    project: Project; proposals: Array<{ id: string; x: number; y: number; elevation: number }>;
  }>('quantize-edge.json');
  const propose = (id: string) => {
    const q = proposals.find((x) => x.id === id)!;
    return proposePlaceFurniture(project, {
      id, definitionId: 'chair', roomId: 'room-1', position: { x: q.x, y: q.y }, elevation: q.elevation,
      rotation: 0, width: 0.5, length: 0.5, height: 0.9,
    });
  };
  it('0.2504 → 0.25 and 0.0004 → 0: the corner lands exactly on the wall and is touching (valid)', () => {
    const r = propose('edge-ok');
    expect(r.rejected).toBe(false);
    if (!r.rejected) {
      const i = (r.command as { instance: { position: { x: number }; elevation: number } }).instance;
      expect(i.position.x).toBe(0.25);
      expect(i.elevation).toBe(0);
    }
  });
  it('0.2496 → 0.25 and 0.0005 → 0.001 (midpoint rounds away from zero)', () => {
    const r = propose('edge-mid');
    expect(r.rejected).toBe(false);
    if (!r.rejected) {
      const i = (r.command as { instance: { position: { x: number }; elevation: number } }).instance;
      expect(i.position.x).toBe(0.25);
      expect(i.elevation).toBe(0.001);
    }
  });
  it('0.2494 → 0.249: the left edge lands 1 mm outside → rejected outside_room', () => {
    const r = propose('edge-out');
    expect(r.rejected).toBe(true);
    if (r.rejected) expect(r.violations[0]).toMatchObject({ type: 'outside_room', severity: 'hard' });
  });
});

describe('perf-100 (all valid)', () => {
  it('100 instances, mixed rotations and elevations, no violations', () => {
    const p = loadScenario('perf-100.json');
    expect(p.rooms[0].furniture).toHaveLength(100);
    expect(new Set(p.rooms[0].furniture.map((f) => f.rotation)).size).toBeGreaterThan(3);
    expect(new Set(p.rooms[0].furniture.map((f) => f.elevation)).size).toBe(2);
    expect(validateRoom(p.rooms[0], p.furnitureDefinitions)).toEqual({ valid: true, violations: [] });
  });
});
