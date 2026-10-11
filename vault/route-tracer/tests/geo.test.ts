import { describe, expect, it } from 'vitest';
import {
  addVertex, cancelStroke, closeLoop, deleteVertex, displayLines, emptyDraw, endStroke, extendStroke, finish, fromLines, hasWork, hitTest, insertVertex,
  midOf, outAndBack, pushHistory, setVertex, startStroke, undo,
} from '../src/drawing';
import {
  bboxOf, degreesPerPixel, formatDistance, lineKm, markersAlong, metersPerPixel, nearestOnLines, segmentKm, simplifyLine, stepKmFor, thinFactor, toGpx, totalKm, validateLines,
  type Line,
} from '../src/geo';

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

describe('distance markers', () => {
  const meridian: Line = [[0, 0], [0, 0.1]]; // about 11.12 km
  it('segmentKm agrees with the readout maths', () => {
    expect(segmentKm([0, 0], [0, 0.1])).toBeCloseTo(lineKm(meridian), 9);
    expect(segmentKm([5, 5], [5, 5])).toBe(0);
  });
  it('puts a marker at every km, numbered 1..11, each at the right distance along the line', () => {
    const ms = markersAlong([meridian], 1);
    expect(ms.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const m of ms) expect(lineKm([[0, 0], m.pos])).toBeCloseTo(m.n, 2);
  });
  it('no marker before the first km, and none on empty or single-point lines', () => {
    expect(markersAlong([[[0, 0], [0, 0.005]]], 1)).toEqual([]);
    expect(markersAlong([], 1)).toEqual([]);
    expect(markersAlong([[[0, 0]]], 1)).toEqual([]);
    expect(markersAlong([[[0, 0], [0, 0]]], 1)).toEqual([]);
  });
  it('a marker lands exactly on a line that is a whole number of steps long', () => {
    const km2: Line = [[0, 0], [0, 2 / 111.19492664455873]];
    expect(markersAlong([km2], 1).map((m) => m.n)).toEqual([1, 2]);
  });
  it('distance carries on across strokes without counting the gap', () => {
    const a: Line = [[0, 0], [0, 0.0045]]; // about 0.5 km
    const b: Line = [[1, 0], [1, 0.0135]]; // about 1.5 km, far away
    const ms = markersAlong([a, b], 1);
    expect(ms.map((m) => m.n)).toEqual([1, 2]);
    expect(ms[0].pos[0]).toBe(1); // marker 1 is on the second stroke, 0.5 km into it
    expect(lineKm([[1, 0], ms[0].pos])).toBeCloseTo(0.5, 2);
  });
  it('follows the corners of a bent line', () => {
    const bent: Line = [[0, 0], [0, 0.0135], [0.0135, 0.0135]]; // about 1.5 km north then 1.5 km east
    const ms = markersAlong([bent], 1);
    expect(ms).toHaveLength(3); // the two legs are each about 1.5 km, so 3 km in all
    expect(ms[0].pos[0]).toBe(0); // marker 1 is still on the northward leg
    expect(ms[1].pos[0]).toBeGreaterThan(0); // marker 2 is on the eastward leg
    expect(ms[1].pos[1]).toBeCloseTo(0.0135, 5);
  });
  it('miles: every 1.609344 km, numbered in miles', () => {
    expect(stepKmFor('km')).toBe(1);
    expect(stepKmFor('mi')).toBeCloseTo(1.609344, 9);
    expect(markersAlong([meridian], stepKmFor('mi')).map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('gives up rather than build thousands of markers', () => {
    expect(markersAlong([[[0, 0], [0, 80]]], 0.01)).toEqual([]);
    expect(markersAlong([meridian], 0)).toEqual([]);
  });
  it('thinning: every marker when there is room, every Nth when zoomed out, capped in number', () => {
    expect(thinFactor(200, 10)).toBe(1);
    expect(thinFactor(15, 10)).toBe(5); // 15 px per km -> every 5th is 75 px apart
    expect(thinFactor(1, 10)).toBe(50);
    expect(thinFactor(200, 1000)).toBe(5); // 1000 markers: at most 300 shown
    expect(thinFactor(0.0001, 10)).toBe(1000);
    expect(metersPerPixel(10, 0)).toBeCloseTo(76.44, 1);
  });
});

describe('tap a track', () => {
  const flat = ([x, y]: [number, number]) => ({ x: x * 1000, y: -y * 1000 }); // 1000 px per degree
  const track: Line[] = [[[0, 0], [0.02, 0]]]; // about 2.22 km, 20 px long
  const total = lineKm(track[0]);

  it('snaps to the nearest point and says how far along it is', () => {
    const r = nearestOnLines(track, flat, { x: 10, y: 4 }, 22)!;
    expect(r.pos[0]).toBeCloseTo(0.01, 9);
    expect(r.pos[1]).toBeCloseTo(0, 9);
    expect(r.km).toBeCloseTo(total / 2, 6);
    expect(r.totalKm).toBeCloseTo(total, 9);
    expect(r.px).toBeCloseTo(4, 9);
  });
  it('a tap beyond the ends snaps to the start or the end', () => {
    expect(nearestOnLines(track, flat, { x: -8, y: 0 }, 22)!.km).toBe(0);
    expect(nearestOnLines(track, flat, { x: 27, y: 0 }, 22)!.km).toBeCloseTo(total, 9);
  });
  it('a tap too far from the line finds nothing', () => {
    expect(nearestOnLines(track, flat, { x: 10, y: 40 }, 22)).toBeNull();
    expect(nearestOnLines([], flat, { x: 0, y: 0 }, 22)).toBeNull();
  });
  it('follows corners: distance is along the line, not as the crow flies', () => {
    const bent: Line[] = [[[0, 0], [0, 0.02], [0.02, 0.02]]]; // north 20 px then east 20 px
    const r = nearestOnLines(bent, flat, { x: 20, y: -20 }, 5)!; // the far end, 40 px of line away
    expect(r.km).toBeCloseTo(lineKm(bent[0]), 6);
    expect(r.km).toBeGreaterThan(lineKm([[0, 0], [0.02, 0.02]]));
  });
  it('strokes join up without counting the gap, like the readout', () => {
    const two: Line[] = [[[0, 0], [0.02, 0]], [[0.5, 0.5], [0.52, 0.5]]];
    const r = nearestOnLines(two, flat, { x: 510, y: -500 }, 22)!; // halfway along the second stroke
    expect(r.km).toBeCloseTo(lineKm(two[0]) + lineKm(two[1]) / 2, 6);
    expect(r.totalKm).toBeCloseTo(totalKm(two), 9);
  });
  it('picks the nearer of two overlapping segments', () => {
    const r = nearestOnLines([[[0, 0], [0.02, 0]], [[0, 0.003], [0.02, 0.003]]], flat, { x: 10, y: -2 }, 22)!;
    expect(r.px).toBeCloseTo(1, 9); // the second line, 3 px up, is closer to a tap 2 px up
    expect(r.pos[1]).toBeCloseTo(0.003, 9);
  });
});

describe('loop and out-and-back', () => {
  const route = () => fromLines([[[153, -27], [153.01, -27.005], [153.02, -27]]]);
  const km = (d: ReturnType<typeof emptyDraw>) => totalKm(d.lines);

  it('return to start adds one straight segment back to the first point', () => {
    const r = closeLoop(route());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines[0]).toHaveLength(4);
    expect(r.state.lines[0][3]).toEqual([153, -27]);
    expect(km(r.state)).toBeCloseTo(km(route()) + lineKm([[153.02, -27], [153, -27]]), 9);
  });
  it('return to start is one undo step', () => {
    const r = closeLoop(route());
    expect(r.ok && undo(r.state).lines).toEqual(route().lines);
  });
  it('return to start with several strokes closes from the last end to the very first point', () => {
    const d = fromLines([[[0, 0], [0, 0.01]], [[1, 1], [1.01, 1]]]);
    const r = closeLoop(d);
    expect(r.ok && r.state.lines[1].at(-1)).toEqual([0, 0]);
    expect(r.ok && r.state.lines[0]).toEqual(d.lines[0]);
  });
  it('return to start refuses when there is nothing to close or it is already closed', () => {
    expect(closeLoop(emptyDraw()).ok).toBe(false);
    expect(closeLoop(fromLines([[[0, 0]]])).ok).toBe(false);
    const closed = closeLoop(route());
    expect(closed.ok && closeLoop(closed.state).ok).toBe(false);
  });
  it('return to start refuses past the point limit', () => {
    const big = fromLines([Array.from({ length: 20000 }, (_, i) => [i * 1e-4, 0] as [number, number])]);
    expect(closeLoop(big).ok).toBe(false);
  });

  it('out and back doubles the distance and ends where it began', () => {
    const r = outAndBack(route());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(km(r.state)).toBeCloseTo(km(route()) * 2, 9);
    expect(r.state.lines).toHaveLength(1);
    expect(r.state.lines[0]).toHaveLength(5); // the turnaround point is shared
    expect(r.state.lines[0].at(-1)).toEqual([153, -27]);
    expect(r.state.lines[0][2]).toEqual([153.02, -27]);
  });
  it('out and back mirrors the path point for point', () => {
    const r = outAndBack(route());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = r.state.lines[0];
    expect(l.slice(0, 3)).toEqual(l.slice(2).reverse());
  });
  it('out and back with several strokes retraces each in reverse order; the gaps stay gaps', () => {
    const d = fromLines([[[0, 0], [0, 0.01]], [[1, 1], [1.01, 1]]]);
    const r = outAndBack(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines).toHaveLength(3);
    expect(r.state.lines[1]).toEqual([[1, 1], [1.01, 1], [1, 1]]);
    expect(r.state.lines[2]).toEqual([[0, 0.01], [0, 0]]);
    expect(km(r.state)).toBeCloseTo(km(d) * 2, 9);
  });
  it('out and back is one undo step, and can be done again', () => {
    const r = outAndBack(route());
    expect(r.ok && undo(r.state).lines).toEqual(route().lines);
    const twice = r.ok ? outAndBack(r.state) : r;
    expect(twice.ok && km(twice.state)).toBeCloseTo(km(route()) * 4, 9);
  });
  it('out and back refuses with nothing drawn or past the point limit', () => {
    expect(outAndBack(emptyDraw()).ok).toBe(false);
    expect(outAndBack(fromLines([[[0, 0]]])).ok).toBe(false);
    const big = fromLines([Array.from({ length: 10001 }, (_, i) => [i * 1e-4, 0] as [number, number])]);
    expect(outAndBack(big).ok).toBe(false);
  });
});
