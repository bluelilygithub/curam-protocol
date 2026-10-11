import { describe, expect, it } from 'vitest';
import {
  addVertex, cancelStroke, deleteVertex, displayLines, emptyDraw, endStroke, extendStroke, finish, fromLines, hasWork, hitTest, insertVertex,
  midOf, pushHistory, setVertex, startStroke, undo,
} from '../src/drawing';
import { bboxOf, degreesPerPixel, formatDistance, lineKm, simplifyLine, toGpx, totalKm, validateLines, type Line } from '../src/geo';

const within = (actual: number, expected: number, pct: number) => expect(Math.abs(actual - expected) / expected).toBeLessThan(pct / 100);

describe('distance', () => {
  it('1 degree of latitude along a meridian is about 111.2 km', () => {
    within(lineKm([[0, 0], [0, 1]]), 111.2, 0.5);
  });
  it('Brisbane CBD to Surfers Paradise is about 71.4 km', () => {
    within(lineKm([[153.028, -27.468], [153.43, -28.002]]), 71.4, 0.5);
  });
  it('empty, single-point and zero-length lines are 0', () => {
    expect(lineKm([])).toBe(0);
    expect(lineKm([[10, 10]])).toBe(0);
    expect(lineKm([[10, 10], [10, 10]])).toBe(0);
    expect(totalKm([])).toBe(0);
  });
  it('the gap between two strokes is not counted', () => {
    const a: Line = [[0, 0], [0, 0.1]];
    const b: Line = [[1, 0], [1, 0.1]];
    expect(totalKm([a, b])).toBeCloseTo(lineKm(a) + lineKm(b), 9);
  });
});

describe('simplify', () => {
  it('keeps endpoints and cuts points on a near-straight line', () => {
    const line: Line = Array.from({ length: 200 }, (_, i) => [151 + i * 0.0001, -33 + (i % 2 ? 0.0000001 : 0)] as [number, number]);
    const out = simplifyLine(line, degreesPerPixel(14));
    expect(out[0]).toEqual(line[0]);
    expect(out[out.length - 1]).toEqual(line[line.length - 1]);
    expect(out.length).toBeLessThan(line.length * 0.3);
  });
  it('leaves two points alone', () => {
    expect(simplifyLine([[0, 0], [1, 1]], 0.1)).toEqual([[0, 0], [1, 1]]);
  });
});

describe('format', () => {
  it('km under 1 shows metres, else 2 decimals', () => {
    expect(formatDistance(0.4216, 'km')).toBe('422 m');
    expect(formatDistance(3.4161, 'km')).toBe('3.42 km');
  });
  it('miles under 0.1 shows feet, else 2 decimals', () => {
    expect(formatDistance(0.1, 'mi')).toBe('328 ft');
    expect(formatDistance(10, 'mi')).toBe('6.21 mi');
  });
});

describe('validate and bbox', () => {
  it('rejects empty, out of range and too many points', () => {
    expect(validateLines([])).not.toBeNull();
    expect(validateLines([[[0, 0]]])).not.toBeNull();
    expect(validateLines([[[0, 0], [181, 0]]])).not.toBeNull();
    expect(validateLines([[[0, 0], [0, 91]]])).not.toBeNull();
    expect(validateLines([Array.from({ length: 20001 }, () => [0, 0] as [number, number])])).not.toBeNull();
    expect(validateLines([[[0, 0], [1, 1]]])).toBeNull();
  });
  it('bbox spans all strokes', () => {
    expect(bboxOf([[[1, 2], [3, 4]], [[-1, 0], [0, 9]]])).toEqual([-1, 0, 3, 9]);
    expect(bboxOf([])).toBeNull();
  });
});

describe('gpx', () => {
  it('writes one trkseg per stroke and escapes text', () => {
    const g = toGpx('A & B <1>', null, [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]);
    expect(g.match(/<trkseg>/g)).toHaveLength(2);
    expect(g).toContain('A &amp; B &lt;1&gt;');
    expect(g).toContain('<trkpt lat="2" lon="1"/>');
  });
});

describe('drawing state', () => {
  const stroke = (s = emptyDraw(), near = false, pts: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0]]) => {
    let d = startStroke(s, pts[0], near);
    for (const p of pts.slice(1)) d = extendStroke(d, p);
    return endStroke(d, 0.0001);
  };

  it('a freehand stroke commits as one undo step', () => {
    const d = stroke();
    expect(d.lines).toHaveLength(1);
    expect(undo(d).lines).toHaveLength(0);
  });
  it('a stroke far from the last end starts a new line; undo removes exactly that stroke', () => {
    const d = stroke(stroke(), false, [[1, 1], [1.01, 1]]);
    expect(d.lines).toHaveLength(2);
    expect(undo(d).lines).toHaveLength(1);
  });
  it('a stroke near the last end continues the same line and undo removes only that stroke', () => {
    const one = stroke();
    const d = stroke(one, true, [[0.02, 0], [0.03, 0], [0.04, 0]]);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0][d.lines[0].length - 1]).toEqual([0.04, 0]);
    expect(undo(d).lines).toEqual(one.lines);
  });
  it('live display joins a continuing stroke onto the last line', () => {
    let d = stroke();
    d = extendStroke(startStroke(d, [0.02, 0], true), [0.03, 0]);
    expect(displayLines(d)).toHaveLength(1);
    expect(totalKm(displayLines(d))).toBeGreaterThan(totalKm(stroke().lines));
  });
  it('a stroke that never moved is dropped', () => {
    expect(endStroke(startStroke(emptyDraw(), [0, 0], false), 0.0001).lines).toHaveLength(0);
  });
  it('cancel throws the live stroke away', () => {
    const d = cancelStroke(extendStroke(startStroke(emptyDraw(), [0, 0], false), [1, 1]));
    expect(d.active).toBeNull();
    expect(hasWork(d)).toBe(false);
  });
  it('click mode: undo removes exactly one point', () => {
    let d = emptyDraw();
    for (const p of [[0, 0], [0, 1], [0, 2]] as [number, number][]) d = addVertex(d, p);
    expect(d.lines[0]).toHaveLength(3);
    d = undo(d);
    expect(d.lines[0]).toHaveLength(2);
    d = undo(undo(d));
    expect(d.lines).toHaveLength(0);
  });
  it('finish drops a lone start marker', () => {
    expect(finish(addVertex(emptyDraw(), [0, 0]))).toHaveLength(0);
  });
});

describe('edit mode', () => {
  const base = () => fromLines([[[0, 0], [0.02, 0], [0.04, 0]]]);
  // a flat projection: 1000 px per degree, so a 0.02 degree segment is 20 px
  const project = ([x, y]: [number, number]) => ({ x: x * 1000, y: -y * 1000 });

  it('setVertex moves one point and leaves the rest', () => {
    const d = setVertex(base(), { li: 0, vi: 1 }, [0.02, 0.01]);
    expect(d.lines[0]).toEqual([[0, 0], [0.02, 0.01], [0.04, 0]]);
    expect(d.history).toHaveLength(0);
  });
  it('a drag is one undo step: pushHistory once, then many setVertex calls', () => {
    let d = pushHistory(base());
    for (const y of [0.001, 0.002, 0.003]) d = setVertex(d, { li: 0, vi: 1 }, [0.02, y]);
    expect(undo(d).lines).toEqual(base().lines);
  });
  it('insertVertex adds a point between two others; undo removes exactly it', () => {
    const d = insertVertex(base(), { li: 0, vi: 1 }, midOf([0, 0], [0.02, 0]));
    expect(d.lines[0]).toEqual([[0, 0], [0.01, 0], [0.02, 0], [0.04, 0]]);
    expect(undo(d).lines).toEqual(base().lines);
  });
  it('insertVertex refuses a position outside the line', () => {
    expect(insertVertex(base(), { li: 0, vi: 0 }, [9, 9]).lines).toEqual(base().lines);
    expect(insertVertex(base(), { li: 0, vi: 4 }, [9, 9]).lines).toEqual(base().lines);
    expect(insertVertex(base(), { li: 3, vi: 1 }, [9, 9]).lines).toEqual(base().lines);
  });
  it('deleteVertex removes a point (one undo step) but never leaves a stroke under two points', () => {
    const d = deleteVertex(base(), { li: 0, vi: 1 });
    expect(d?.lines[0]).toEqual([[0, 0], [0.04, 0]]);
    expect(undo(d!).lines).toEqual(base().lines);
    expect(deleteVertex(d!, { li: 0, vi: 0 })).toBeNull();
    expect(deleteVertex(base(), { li: 0, vi: 7 })).toBeNull();
  });
  it('hitTest prefers a point within reach, else a long-enough segment middle, else nothing', () => {
    const lines = base().lines;
    expect(hitTest(lines, project, { x: 21, y: 3 }, 14)).toEqual({ kind: 'vertex', li: 0, vi: 1 });
    // the middle of the first segment is 10 px from both ends: the point wins when it is in reach
    expect(hitTest(lines, project, { x: 10, y: 0 }, 14)?.kind).toBe('vertex');
    // segments are 20 px long: below a 28 px minimum there is no middle handle
    expect(hitTest(lines, project, { x: 30, y: 0 }, 4, 28)).toBeNull();
    // zoomed in (segments 200 px long) the middle handle is offered and carries the new point's position
    const zoomed = ([x, y]: [number, number]) => ({ x: x * 10000, y: -y * 10000 });
    expect(hitTest(lines, zoomed, { x: 100, y: 2 }, 14)).toEqual({ kind: 'mid', li: 0, vi: 1, pos: [0.01, 0] });
    expect(hitTest(lines, zoomed, { x: 100, y: 80 }, 14)).toBeNull();
  });
});
