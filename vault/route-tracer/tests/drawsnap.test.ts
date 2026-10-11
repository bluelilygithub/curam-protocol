import { describe, expect, it } from 'vitest';
import {
  addVertex, canSnap, cleared, closeLoop, emptyDraw, endStroke, extendStroke, fromLines, hasWork, outAndBack, pushHistory, snapApply, snapClick, snapCounts, snapDelete,
  snapFail, snapInsert, snapMarkPending, snapMove, snapRelease, snapRetry, snapWanted, startStroke, undo, type DrawState,
} from '../src/drawing';
import type { Line, Pos } from '../src/geo';
import { lineKm } from '../src/geo';

const A: Pos = [153.0, -27.5];
const B: Pos = [153.004, -27.5];
const C: Pos = [153.004, -27.504];
const road = (p: Pos, q: Pos): Line => [[p[0] + 0.00001, p[1]], [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 0.0008], [q[0] - 0.00001, q[1]]];
const clicks = (...pts: Pos[]): DrawState => pts.reduce((s, p) => snapClick(s, p, 'walking'), emptyDraw());
const routeAll = (s: DrawState): DrawState => snapWanted(s).reduce((st, w) => snapApply(st, w.sig, road(w.from, w.to)), s);

describe('clicking with Follow roads', () => {
  it('the first click is a start marker, each later click adds a leg that wants a road', () => {
    const s = clicks(A, B, C);
    expect(s.snap!.wps).toEqual([A, B, C]);
    expect(s.lines).toEqual([[A, B, C]]); // straight lines until the roads arrive
    expect(snapWanted(s)).toHaveLength(2);
    expect(hasWork(s)).toBe(true);
  });
  it('the drawn line follows the roads once they arrive, and stays one line', () => {
    const s = routeAll(clicks(A, B, C));
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].length).toBeGreaterThan(3);
    expect(lineKm(s.lines[0])).toBeGreaterThan(lineKm([A, B, C]));
    expect(snapWanted(s)).toEqual([]);
  });
  it('with no way of travelling (Follow roads off) the leg is straight and never asked for', () => {
    const s = snapClick(clicks(A, B), C, null);
    expect(snapWanted(s)).toHaveLength(1);
    expect(s.snap!.legs[1].state).toBe('straight');
  });
  it('each click is one undo step, and undo takes the waypoint and its road back together', () => {
    const s = routeAll(clicks(A, B, C));
    const back = undo(s);
    expect(back.snap!.wps).toEqual([A, B]);
    expect(back.lines[0].length).toBeLessThan(s.lines[0].length);
    expect(undo(undo(back)).lines).toEqual([]);
    expect(undo(undo(back)).snap).toBeNull();
  });
  it('Follow roads works on an empty drawing or a road-following route, not on a plain line', () => {
    expect(canSnap(emptyDraw())).toBe(true);
    expect(canSnap(clicks(A, B))).toBe(true);
    expect(canSnap(fromLines([[A, B]]))).toBe(false);
    expect(canSnap(addVertex(emptyDraw(), A))).toBe(false);
    const plain = fromLines([[A, B]]);
    expect(snapClick(plain, C, 'walking')).toBe(plain); // refused
  });
});

describe('the bookkeeping as requests go out and come back', () => {
  it('marks pending, applies by identity, fails by identity, retries', () => {
    let s = clicks(A, B, C);
    const [w0, w1] = snapWanted(s);
    s = snapMarkPending(s, new Set([w0.sig, w1.sig]));
    expect(snapCounts(s)).toEqual({ waiting: 2, failed: 0, routed: 0, straight: 0 });
    s = snapApply(s, w0.sig, road(A, B));
    s = snapFail(s, w1.sig);
    expect(snapCounts(s)).toEqual({ waiting: 0, failed: 1, routed: 1, straight: 0 });
    expect(snapWanted(s)).toEqual([]);
    s = snapRetry(s);
    expect(snapWanted(s).map((w) => w.sig)).toEqual([w1.sig]);
  });
  it('none of these is an undo step', () => {
    let s = clicks(A, B);
    const n = s.history.length;
    s = snapMarkPending(s, new Set([snapWanted(s)[0].sig]));
    s = snapApply(s, snapWanted(s)[0].sig, road(A, B));
    expect(s.history.length).toBe(n);
  });
  it('undoing to a point where a leg was still waiting wants that leg routed again', () => {
    const waiting = snapClick(clicks(A, B), C, 'walking'); // A-B and B-C both wait
    const partly = snapApply(waiting, snapWanted(waiting)[0].sig, road(A, B)); // A-B arrives
    const next = snapClick(partly, A, 'walking'); // one more click
    const back = undo(next);
    expect(back.snap!.wps).toEqual([A, B, C]);
    expect(snapWanted(back).map((w) => w.index)).toEqual([1]); // B-C still waiting; A-B kept its road
  });
});

describe('moving, adding and deleting waypoints', () => {
  it('a drag: one undo step for the whole drag, held straight while dragging, routed again on release', () => {
    let s = routeAll(clicks(A, B, C));
    const before = s.history.length;
    s = pushHistory(s);
    s = snapMove(s, 1, [153.002, -27.502]);
    s = snapMove(s, 1, [153.003, -27.503]);
    expect(snapWanted(s)).toEqual([]); // nothing is asked for mid-drag
    expect(snapCounts(s).waiting).toBe(2);
    s = snapRelease(s);
    expect(snapWanted(s)).toHaveLength(2);
    expect(s.history.length).toBe(before + 1);
    const back = undo(s);
    expect(back.snap!.wps[1]).toEqual(B);
    expect(snapCounts(back).routed).toBe(2); // the roads that were there are back
  });
  it('adding a waypoint in the middle of a leg splits it (one undo step)', () => {
    const s = snapInsert(routeAll(clicks(A, B)), 0, [153.002, -27.499]);
    expect(s.snap!.wps).toHaveLength(3);
    expect(snapWanted(s)).toHaveLength(2);
    expect(undo(s).snap!.wps).toHaveLength(2);
  });
  it('deleting joins the two legs; at least two waypoints stay', () => {
    const s = routeAll(clicks(A, B, C));
    const d = snapDelete(s, 1)!;
    expect(d.snap!.wps).toEqual([A, C]);
    expect(snapWanted(d)).toHaveLength(1);
    expect(undo(d).snap!.wps).toEqual([A, B, C]);
    expect(snapDelete(d, 0)).toBeNull();
  });
});

describe('return to start, out and back', () => {
  it('return to start adds a road back to the first waypoint', () => {
    const r = closeLoop(routeAll(clicks(A, B, C)), 'walking');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.snap!.wps).toEqual([A, B, C, A]);
    expect(snapWanted(r.state)).toHaveLength(1);
    expect(undo(r.state).snap!.wps).toEqual([A, B, C]);
  });
  it('and refuses when the route already ends where it began', () => {
    const loop = routeAll(clicks(A, B, A));
    expect(closeLoop(loop, 'walking').ok).toBe(false);
  });
  it('out and back doubles the roads without asking for them again', () => {
    const s = routeAll(clicks(A, B, C));
    const r = outAndBack(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(snapWanted(r.state)).toEqual([]);
    expect(lineKm(r.state.lines[0])).toBeCloseTo(lineKm(s.lines[0]) * 2, 1);
    expect(undo(r.state).lines).toEqual(s.lines);
  });
});

describe('leaving the road-following model', () => {
  it('a freehand stroke turns the route into a plain line (and one undo brings the roads back)', () => {
    const s = routeAll(clicks(A, B));
    const drawn = endStroke(extendStroke(startStroke(s, B, true), [153.006, -27.5]), 0.00001);
    expect(drawn.snap).toBeNull();
    expect(drawn.lines[0].length).toBeGreaterThan(2);
    expect(undo(drawn).snap).not.toBeNull();
  });
  it('a plain click on a road-following route (addVertex) detaches it too', () => {
    const s = addVertex(routeAll(clicks(A, B)), C);
    expect(s.snap).toBeNull();
    expect(undo(s).snap).not.toBeNull();
  });
  it('Clear throws everything away, the route included', () => {
    const s = cleared(routeAll(clicks(A, B, C)));
    expect(s.snap).toBeNull();
    expect(s.lines).toEqual([]);
    expect(s.history).toEqual([]);
  });
});
