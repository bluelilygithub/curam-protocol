// Hover labels in the plan, and the "room is out of view" test behind the Show room chip.
import { describe, expect, it } from 'vitest';
import { FURNITURE_LIBRARY } from '../../src/data/furnitureLibrary';
import { hoverText } from '../../src/ui/hoverLabel';
import { visibleFraction } from '../../src/ui/RecentreChip';
import { makeDoor, makeInstance, makeProject, makeRoom } from '../helpers';

const sofa = makeInstance({ id: 's', definitionId: 'sofa-3', position: { x: 2, y: 2.5 }, width: 2.2, length: 0.95, height: 0.85 });
const art = makeInstance({ id: 'a', definitionId: 'art-landscape', position: { x: 2, y: 4.985 }, width: 0.9, length: 0.03, height: 0.6, elevation: 1.3 });
const project = makeProject([makeRoom({ furniture: [sofa, art], fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1.2, width: 0.9, height: 2.04 })] })], FURNITURE_LIBRARY);

describe('hover text', () => {
  it('names a piece with its size', () => {
    expect(hoverText(project, { x: 2, y: 2.5 })).toBe('3-seat sofa · 2.2 × 0.95 × 0.85 m');
  });
  it('says how high a raised piece is', () => {
    expect(hoverText(project, { x: 2, y: 4.985 }, 0.05)).toBe('Painting: landscape · 0.9 × 0.03 × 0.6 m · at 1.3 m');
  });
  it('names a door or window with its opening size', () => {
    const t = hoverText(project, { x: 1.2, y: 0 }, 0.1);
    expect(t).toMatch(/^Door · 0\.9 × 2\.04 m$/);
  });
  it('says nothing over bare floor, over a wall, or with no room', () => {
    expect(hoverText(project, { x: 0.3, y: 1.0 })).toBeNull();
    expect(hoverText(project, { x: 2, y: 5.05 }, 0.01)).toBeNull();
    expect(hoverText(null, { x: 2, y: 2.5 })).toBeNull();
    expect(hoverText(makeProject([]), { x: 2, y: 2.5 })).toBeNull();
  });
});

describe('how much of the room is in view', () => {
  const box = { min: { x: 0, y: 0 }, max: { x: 4, y: 5 } };
  const viewport = { width: 800, height: 600 };
  // the canvas flips y: world y up is canvas y down, so offsetY is where world y = 0 sits
  it('is all of it when the room is fitted on the page', () => {
    expect(visibleFraction(box, { scale: 100, offsetX: 100, offsetY: 560 }, viewport)).toBeCloseTo(1, 9);
  });
  it('falls to a part, then to nothing, as the room is dragged away', () => {
    const part = visibleFraction(box, { scale: 100, offsetX: 750, offsetY: 560 }, viewport);
    expect(part).toBeGreaterThan(0.1);
    expect(part).toBeLessThan(0.3);
    expect(visibleFraction(box, { scale: 100, offsetX: 5000, offsetY: 560 }, viewport)).toBe(0);
    expect(visibleFraction(box, { scale: 100, offsetX: -9000, offsetY: -9000 }, viewport)).toBe(0);
  });
  it('a room zoomed in far past the page is still "in view" (it fills the page)', () => {
    expect(visibleFraction(box, { scale: 1000, offsetX: -1500, offsetY: 4000 }, viewport)).toBeGreaterThan(0.01);
  });
});
