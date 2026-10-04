// Snap controls (M4.9): Smart / Grid only / Off, grid measured from the room corner, Alt to bypass; wall art takes its hanging height.
import { describe, expect, it } from 'vitest';
import { inst, makeHarness } from './harness';

const sofa = () => inst({ id: 'a', position: { x: 2, y: 2.5 }, width: 1, length: 0.6, height: 0.85 }); // 1.0 × 0.6 so the numbers are easy
const near = (v: number, step: number, origin = 0) => Math.abs((v - origin) / step - Math.round((v - origin) / step)) < 0.01;

describe('snap modes', () => {
  it('Grid only: a dragged piece ends with an edge on a grid line, measured from the room corner', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().setSnapMode('grid');
    h.ui.getState().setGrid(0.25);
    h.drag([2, 2.5], [2.13, 2.61]); // lands near (2.13, 2.61): left edge 1.63, right 2.63, top 2.31, bottom 2.91
    const p = h.inst('a');
    const o = h.room().vertices[0].position;
    expect(near(p.position.x - 0.5, 0.25, o.x) || near(p.position.x + 0.5, 0.25, o.x)).toBe(true);
    expect(near(p.position.y - 0.3, 0.25, o.y) || near(p.position.y + 0.3, 0.25, o.y)).toBe(true);
  });
  it('Off: the piece lands exactly where the pointer put it (to the millimetre), with no snapping', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().setSnapMode('off');
    h.drag([2, 2.5], [2.137, 2.613]);
    const p = h.inst('a');
    expect(p.position.x).toBeCloseTo(2.137, 3);
    expect(p.position.y).toBeCloseTo(2.613, 3);
  });
  it('holding Alt skips snapping for that drag even in Smart mode', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.drag([2, 2.5], [2.137, 2.613], 12, { alt: true });
    const p = h.inst('a');
    expect(p.position.x).toBeCloseTo(2.137, 3);
    expect(p.position.y).toBeCloseTo(2.613, 3);
  });
  it('Smart (the default) still snaps', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.drag([2, 2.5], [2.137, 2.613]);
    const p = h.inst('a');
    expect(Math.abs(p.position.x - 2.137) + Math.abs(p.position.y - 2.613)).toBeGreaterThan(0.004);
  });
  it('Measure uses the same rules: Off gives the raw point', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().setSnapMode('off');
    expect(h.ui.getState().snapEnabled).toEqual([]);
  });
});

describe('wall art placement', () => {
  it('a picture takes its hanging height when placed, and sits flush on the wall', () => {
    const h = makeHarness({ furniture: [] });
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'art-landscape' });
    h.it.pointerMove(h.ptr(2, 4.9)); // near the wall at y = 5
    h.it.pointerDown(h.ptr(2, 4.9));
    const placed = h.room().furniture.find((f) => f.definitionId === 'art-landscape');
    expect(placed).toBeDefined();
    expect(placed!.elevation).toBeCloseTo(1.3, 3);
    expect(placed!.height).toBeCloseTo(0.6, 3);
  });
  it('a normal piece still starts on the floor', () => {
    const h = makeHarness({ furniture: [] });
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'coffee-table' });
    h.it.pointerMove(h.ptr(2, 2.5));
    h.it.pointerDown(h.ptr(2, 2.5));
    expect(h.room().furniture[0].elevation).toBe(0);
  });
});
