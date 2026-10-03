import { describe, expect, it } from 'vitest';
import { apply, quantizeRotation, type Project } from '../../src/engine';
import {
  parseLength, previewFixtureEdit, previewFurnitureEdit, previewVertexPosition, previewWallLength, previewWallThickness, readFixtureField, readFurnitureField,
} from '../../src/ui/inspectorLogic';
import { makeDoor } from '../helpers';
import { inst, makeHarness } from './harness';

const proj = (h: ReturnType<typeof makeHarness>): Project => h.state();

describe('parseLength', () => {
  it.each([
    ['1.25', 1.25], ['1250mm', 1.25], ['125cm', 1.25], [' 2 m', 2], ['-.5', -0.5], ['0', 0], ['12MM', 0.012],
  ])('%s -> %s', (text, want) => expect(parseLength(text)).toBeCloseTo(want, 12));
  it.each(['abc', '1,5', '1.5.2', '', '5 ft', 'm'])('%s is not a length', (text) => expect(parseLength(text)).toBeNull());
});

describe('furniture inspector: live validation (A5)', () => {
  const h = makeHarness({ furniture: [inst({ id: 'a' })] });
  it('a valid width is ok and builds a centre-fixed ResizeFurniture, quantized', () => {
    const p = previewFurnitureEdit(proj(h), ['a'], 'width', '2.6004');
    expect(p.state).toBe('ok');
    expect(p.command).toEqual({
      type: 'ResizeFurniture', instanceId: 'a',
      from: { position: { x: 2, y: 2.5 }, width: 2.2, length: 0.95 }, to: { position: { x: 2, y: 2.5 }, width: 2.6, length: 0.95 },
    });
    expect(p.label).toBe('Edit 3-seat sofa');
  });
  it('accepts mm and cm units', () => {
    expect(previewFurnitureEdit(proj(h), ['a'], 'width', '2600mm').state).toBe('ok');
    expect(previewFurnitureEdit(proj(h), ['a'], 'length', '110cm').state).toBe('ok');
  });
  it('a hard violation is flagged with the primary violation as the tooltip and NO command', () => {
    const p = previewFurnitureEdit(proj(h), ['a'], 'width', '5');
    expect(p).toMatchObject({ state: 'hard', command: null, message: '3-seat sofa is outside the room' });
  });
  it('unparseable and out-of-range input is invalid with a plain message', () => {
    expect(previewFurnitureEdit(proj(h), ['a'], 'width', 'abc')).toMatchObject({ state: 'invalid', message: 'Enter a number', command: null });
    expect(previewFurnitureEdit(proj(h), ['a'], 'width', '0.01')).toMatchObject({ state: 'invalid', message: 'Minimum size is 0.05 m' });
    expect(previewFurnitureEdit(proj(h), ['a'], 'height', '0')).toMatchObject({ state: 'invalid' });
    expect(previewFurnitureEdit(proj(h), ['a'], 'meta.unitCost', '-3')).toMatchObject({ state: 'invalid' });
  });
  it('a soft violation is shown but still commits', () => {
    const hh = makeHarness({ furniture: [
      inst({ id: 'a', position: { x: 2, y: 1.5 } }),
      // sofa y 1.025..1.975, soft front zone y 1.975..2.425; chair x 3.1..3.5 is clear of the 2.2 m sofa (x to 3.1)
      // but inside the zone once the sofa is widened to 2.8 m (x to 3.4)
      inst({ id: 'b', definitionId: 'dining-chair', position: { x: 3.3, y: 2.2 }, width: 0.4, length: 0.4, height: 0.85 }),
    ] });
    const p = previewFurnitureEdit(proj(hh), ['a'], 'width', '2.8');
    expect(p.state).toBe('soft');
    expect(p.command).not.toBeNull();
    expect(p.message).toBe("Dining chair is inside 3-seat sofa's clearance zone");
  });
  it('rotation: degrees in, quantized radians out, about the object’s own centre', () => {
    const p = previewFurnitureEdit(proj(makeHarness({ furniture: [inst({ id: 'a', width: 0.8, length: 0.8 })] })), ['a'], 'rotationDeg', '45.04');
    expect(p.state).toBe('ok');
    expect(p.command).toMatchObject({ type: 'RotateFurniture', from: 0 });
    expect((p.command as { to: number }).to).toBe(quantizeRotation((45 * Math.PI) / 180));
  });
  it('position fields move the object; elevation and height are UpdateFurniture', () => {
    expect(previewFurnitureEdit(proj(h), ['a'], 'x', '2.5').command).toMatchObject({ type: 'MoveFurniture', to: { x: 2.5, y: 2.5 } });
    expect(previewFurnitureEdit(proj(h), ['a'], 'elevation', '0.2').command).toMatchObject({ type: 'UpdateFurniture', from: { elevation: 0 }, to: { elevation: 0.2 } });
    expect(previewFurnitureEdit(proj(h), ['a'], 'height', '0.9').command).toMatchObject({ type: 'UpdateFurniture', to: { height: 0.9 } });
  });
  it('the previewed command applies cleanly (quantized, assert-safe) and is exactly what commit would store', () => {
    const p = previewFurnitureEdit(proj(h), ['a'], 'width', '2.6004');
    expect(() => apply(p.command!, proj(h))).not.toThrow();
  });
});

describe('furniture inspector: metadata, finish and lock', () => {
  const h = makeHarness({ furniture: [inst({ id: 'a', metadata: { vendor: 'Old' } })] });
  it('metadata edits are one UpdateFurniture carrying the whole record', () => {
    expect(previewFurnitureEdit(proj(h), ['a'], 'meta.sku', 'SKU-9').command).toEqual({
      type: 'UpdateFurniture', instanceId: 'a', from: { metadata: { vendor: 'Old' } }, to: { metadata: { vendor: 'Old', sku: 'SKU-9' } },
    });
  });
  it('clearing the last metadata field removes the record (null)', () => {
    expect(previewFurnitureEdit(proj(h), ['a'], 'meta.vendor', '').command).toMatchObject({ to: { metadata: null } });
  });
  it('unit cost is numeric', () => {
    expect(previewFurnitureEdit(proj(h), ['a'], 'meta.unitCost', '1299.5').command).toMatchObject({ to: { metadata: { vendor: 'Old', unitCost: 1299.5 } } });
    expect(previewFurnitureEdit(proj(h), ['a'], 'meta.unitCost', 'x').state).toBe('invalid');
  });
  it('finish override replaces the whole record; empty clears it', () => {
    expect(previewFurnitureEdit(proj(h), ['a'], 'finish', 'oak').command).toMatchObject({ from: { finishOverrides: null }, to: { finishOverrides: { main: 'oak' } } });
    expect(previewFurnitureEdit(proj(h), ['a'], 'finish', '').command).toMatchObject({ to: { finishOverrides: null } });
  });
  it('locked: true sets it; false/unlock stores null; the lock toggle is allowed on a locked object', () => {
    expect(previewFurnitureEdit(proj(h), ['a'], 'locked', true)).toMatchObject({ state: 'ok', label: 'Lock 3-seat sofa', command: { to: { locked: true } } });
    const hl = makeHarness({ furniture: [inst({ id: 'a', locked: true })] });
    expect(previewFurnitureEdit(proj(hl), ['a'], 'locked', false)).toMatchObject({ state: 'ok', label: 'Unlock 3-seat sofa', command: { from: { locked: true }, to: { locked: null } } });
  });
  it('every other edit on a locked object is rejected (A16)', () => {
    const hl = makeHarness({ furniture: [inst({ id: 'a', locked: true })] });
    for (const f of ['width', 'height', 'elevation', 'rotationDeg', 'x', 'finish', 'meta.sku'] as const) {
      expect(previewFurnitureEdit(proj(hl), ['a'], f, f === 'finish' || f === 'meta.sku' ? 'x' : '1')).toMatchObject({ state: 'hard', command: null, message: '3-seat sofa is locked' });
    }
  });
});

describe('multi-selection (A9, B4)', () => {
  const h = makeHarness({ furniture: [
    inst({ id: 'a', position: { x: 1.6, y: 1 }, width: 0.8, length: 0.8 }),
    inst({ id: 'b', position: { x: 3.2, y: 3.5 }, width: 0.8, length: 0.8, elevation: 0.5 }),
  ] });
  it('shows Mixed where values differ and the shared value where they match', () => {
    expect(readFurnitureField(proj(h), ['a', 'b'], 'width')).toEqual({ value: 0.8, mixed: false, unavailable: false });
    expect(readFurnitureField(proj(h), ['a', 'b'], 'elevation')).toEqual({ value: undefined, mixed: true, unavailable: false });
  });
  it('position is unavailable for a group', () => {
    expect(readFurnitureField(proj(h), ['a', 'b'], 'x').unavailable).toBe(true);
    expect(previewFurnitureEdit(proj(h), ['a', 'b'], 'x', '2').state).toBe('unavailable');
  });
  it('an absolute value applies to every instance as ONE Composite', () => {
    const p = previewFurnitureEdit(proj(h), ['a', 'b'], 'height', '1.1');
    expect(p.state).toBe('ok');
    expect(p.command).toMatchObject({ type: 'Composite' });
    expect((p.command as { commands: unknown[] }).commands).toHaveLength(2);
    expect(p.label).toBe('Edit 2 objects');
  });
  it('any hard-invalid outcome rejects the WHOLE edit with one aggregated warning', () => {
    const p = previewFurnitureEdit(proj(h), ['a', 'b'], 'width', '3'); // b at x 3.2 would reach 4.7
    expect(p.state).toBe('hard');
    expect(p.command).toBeNull();
    expect(p.message).toMatch(/is outside the room \(the whole edit was rejected\)$/);
  });
  it('rotation is about each instance’s own centre (no position change)', () => {
    const p = previewFurnitureEdit(proj(h), ['a', 'b'], 'rotationDeg', '90');
    expect(p.state).toBe('ok');
    expect((p.command as { commands: Array<{ type: string }> }).commands.every((c) => c.type === 'RotateFurniture')).toBe(true);
  });
  it('metadata and lock apply to all', () => {
    expect((previewFurnitureEdit(proj(h), ['a', 'b'], 'meta.vendor', 'Acme').command as { commands: unknown[] }).commands).toHaveLength(2);
    expect(previewFurnitureEdit(proj(h), ['a', 'b'], 'locked', true).state).toBe('ok');
  });
  it('is rejected as a whole if ANY selected instance is locked', () => {
    const hl = makeHarness({ furniture: [inst({ id: 'a', locked: true, width: 0.8, length: 0.8 }), inst({ id: 'b', position: { x: 3.2, y: 3.5 }, width: 0.8, length: 0.8 })] });
    expect(previewFurnitureEdit(proj(hl), ['a', 'b'], 'height', '1')).toMatchObject({ state: 'hard', message: '3-seat sofa is locked' });
  });
});

describe('fixture inspector', () => {
  const h = makeHarness({ fixtures: [makeDoor({ id: 'd', offsetAlongWall: 2, width: 0.82, height: 2.04 })] });
  const fx = () => h.fixture('d');
  it('reads every field', () => {
    expect(['width', 'height', 'elevation', 'hingeSide', 'swingAngleDeg', 'offsetAlongWall'].map((f) => readFixtureField(fx(), f as never))).toEqual([0.82, 2.04, 0, 'left', 90, 2]);
  });
  it('width, height, hinge, swing and offset build an UpdateFixture', () => {
    expect(previewFixtureEdit(proj(h), 'd', 'width', '0.9').command).toMatchObject({ type: 'UpdateFixture', from: { width: 0.82 }, to: { width: 0.9 } });
    expect(previewFixtureEdit(proj(h), 'd', 'hingeSide', 'right').command).toMatchObject({ to: { hingeSide: 'right' } });
    expect(previewFixtureEdit(proj(h), 'd', 'swingAngleDeg', '120').command).toMatchObject({ to: { swingAngle: (120 * Math.PI) / 180 } });
    expect(previewFixtureEdit(proj(h), 'd', 'offsetAlongWall', '1.5').command).toMatchObject({ to: { offsetAlongWall: 1.5 } });
  });
  it('validates against the wall and the swing', () => {
    expect(previewFixtureEdit(proj(h), 'd', 'offsetAlongWall', '0.3')).toMatchObject({ state: 'hard', message: 'Door does not fit on its wall' });
    expect(previewFixtureEdit(proj(h), 'd', 'elevation', '0.2').state).toBe('hard'); // doors sit at elevation 0
    expect(previewFixtureEdit(proj(h), 'd', 'width', 'abc').state).toBe('invalid');
    expect(previewFixtureEdit(proj(h), 'd', 'swingAngleDeg', '270')).toMatchObject({ state: 'invalid', message: 'Swing must be between 1° and 180°' });
  });
  it('a swing that would hit furniture is rejected', () => {
    const hh = makeHarness({ fixtures: [makeDoor({ id: 'd', offsetAlongWall: 2 })], furniture: [inst({ id: 'a', position: { x: 2.9, y: 0.4 }, width: 0.2, length: 0.2 })] });
    expect(previewFixtureEdit(proj(hh), 'd', 'swingAngleDeg', '180')).toMatchObject({ state: 'hard', message: '3-seat sofa blocks the door swing' });
  });
});

describe('corner position and wall length (M3: this is how room size is set)', () => {
  const h = makeHarness({ furniture: [inst({ id: 'a', position: { x: 2, y: 4.4 }, width: 1, length: 0.6 })] });
  it('a corner coordinate builds one EditWall; mm and cm are accepted', () => {
    const p = previewVertexPosition(proj(h), 'v3', 'x', '3500mm');
    expect(p).toMatchObject({ state: 'ok', label: 'Move corner' });
    expect((p.command as { to: { vertices: Array<{ id: string; position: { x: number; y: number } }> } }).to.vertices[2].position).toEqual({ x: 3.5, y: 5 });
  });
  it('a value that would make the walls cross is refused in plain words, with no command', () => {
    expect(previewVertexPosition(proj(h), 'v3', 'y', '-1')).toMatchObject({ state: 'hard', command: null, message: 'The walls would cross each other' });
  });
  it('typing the same value is a no-op; nonsense is invalid; unknown corner is explained', () => {
    expect(previewVertexPosition(proj(h), 'v3', 'x', '4')).toMatchObject({ state: 'ok', command: null });
    expect(previewVertexPosition(proj(h), 'v3', 'x', 'abc')).toMatchObject({ state: 'invalid', message: 'Enter a number' });
    expect(previewVertexPosition(proj(h), 'zz', 'x', '1')).toMatchObject({ state: 'invalid' });
  });
  it('an edit that would leave furniture outside commits but warns: "1 object will need attention" (soft)', () => {
    expect(previewVertexPosition(proj(h), 'v3', 'y', '3')).toMatchObject({ state: 'soft', message: '1 object will need attention' });
    expect(previewVertexPosition(proj(h), 'v3', 'y', '3').command).not.toBeNull();
  });
  it('wall length: typing 5 on the 4 m floor wall moves its far corner to x = 5', () => {
    const p = previewWallLength(proj(h), 'w1', '5');
    expect(p).toMatchObject({ state: 'ok', label: 'Set wall length' });
    expect((p.command as { to: { vertices: Array<{ position: { x: number } }> } }).to.vertices[1].position.x).toBe(5);
  });
  it('wall length: units, minimum, and the soft warning when it shrinks the room around furniture', () => {
    expect(previewWallLength(proj(h), 'w1', '300cm').state).toBe('ok');
    expect(previewWallLength(proj(h), 'w1', '0.01')).toMatchObject({ state: 'invalid', message: 'A wall must be at least 0.05 m long' });
    expect(previewWallLength(proj(h), 'w1', 'abc').state).toBe('invalid');
    expect(previewWallLength(proj(h), 'w1', '4').command).toBeNull(); // unchanged
    // right wall 5 m -> 1 m puts v3 at (4, 1): the top edge now runs (4,1)→(0,5), cutting through the sofa (y 4.1..4.7 at x = 2 where the edge is at y = 3)
    expect(previewWallLength(proj(h), 'w2', '1')).toMatchObject({ state: 'soft', message: '1 object will need attention' });
    expect(previewWallLength(proj(h), 'w1', '2').state).toBe('ok'); // a shorter floor still contains the sofa
  });
});

describe('wall thickness (B1: numeric only)', () => {
  const h = makeHarness();
  it('builds one EditWall with the same vertices and the new thickness', () => {
    const p = previewWallThickness(proj(h), 'w2', '0.2');
    expect(p.state).toBe('ok');
    const c = p.command as { type: string; from: { vertices: unknown }; to: { vertices: unknown; walls: Array<{ id: string; thickness: number }> } };
    expect(c.type).toBe('EditWall');
    expect(c.to.vertices).toEqual(c.from.vertices);
    expect(c.to.walls.map((w) => [w.id, w.thickness])).toEqual([['w1', 0.15], ['w2', 0.2], ['w3', 0.15], ['w4', 0.15]]);
    expect(p.label).toBe('Edit wall thickness');
  });
  it('accepts mm; quantizes to 1 mm', () => {
    expect((previewWallThickness(proj(h), 'w1', '200mm').command as { to: { walls: Array<{ thickness: number }> } }).to.walls[0].thickness).toBe(0.2);
    expect((previewWallThickness(proj(h), 'w1', '0.2004').command as { to: { walls: Array<{ thickness: number }> } }).to.walls[0].thickness).toBe(0.2);
  });
  it('rejects nonsense and out-of-range; an unchanged value is a no-op', () => {
    expect(previewWallThickness(proj(h), 'w1', 'abc').state).toBe('invalid');
    expect(previewWallThickness(proj(h), 'w1', '5').state).toBe('invalid');
    expect(previewWallThickness(proj(h), 'w1', '0').state).toBe('invalid');
    expect(previewWallThickness(proj(h), 'w1', '0.15')).toMatchObject({ state: 'ok', command: null });
  });
  it('the committed EditWall keeps the interior polygon untouched', () => {
    const p = previewWallThickness(proj(h), 'w3', '0.4');
    const after = apply(p.command!, proj(h));
    expect(after.rooms[0].vertices).toEqual(proj(h).rooms[0].vertices);
  });
});
