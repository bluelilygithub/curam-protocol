import { describe, expect, it } from 'vitest';
import type { Line, Pos } from '../src/geo';
import { lineKm } from '../src/geo';
import {
  addWaypoint, anchorOf, applyLeg, closeLoop, counts, deleteWaypoint, failLeg, hitTestSnap, insertWaypoint, legLine, linesOf, markPending, midOfLine,
  moveWaypoint, outAndBack, releaseHeld, retryFailed, sigOf, startRoute, wanted, type SnapRoute,
} from '../src/snap';

const A: Pos = [153.0, -27.5];
const B: Pos = [153.004, -27.5];
const C: Pos = [153.004, -27.504];
const D: Pos = [153.0, -27.504];
/** A road from p to q that bends (so it is not the straight line), starting and ending a little off the clicked points, as a snapped road does. */
const road = (p: Pos, q: Pos): Line => [[p[0] + 0.00001, p[1] + 0.00001], [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 0.0008], [q[0] - 0.00001, q[1] - 0.00001]];

const three = (profile: 'walking' | null = 'walking'): SnapRoute => addWaypoint(addWaypoint(startRoute(A), B, profile), C, profile);
const routeAll = (r: SnapRoute): SnapRoute => wanted(r).reduce((acc, w) => applyLeg(acc, w.sig, road(w.from, w.to)), r);

describe('building a route', () => {
  it('starts as one waypoint and adds a leg per click', () => {
    const r = three();
    expect(r.wps).toEqual([A, B, C]);
    expect(r.legs).toHaveLength(2);
    expect(r.legs.map((l) => l.state)).toEqual(['stale', 'stale']);
    expect(r.legs[0].line).toEqual([A, B]);
  });
  it('a click made with Follow roads off is a straight leg that is never routed', () => {
    const r = three(null);
    expect(r.legs.map((l) => l.state)).toEqual(['straight', 'straight']);
    expect(wanted(r)).toEqual([]);
  });
  it('mixes: roads for some legs, straight for others', () => {
    const r = addWaypoint(addWaypoint(startRoute(A), B, 'walking'), C, null);
    expect(r.legs.map((l) => l.state)).toEqual(['stale', 'straight']);
    expect(wanted(r)).toHaveLength(1);
  });
});

describe('what has to be routed', () => {
  it('lists the waiting legs with an identity that depends on the way of travelling and both points', () => {
    const r = three();
    const w = wanted(r);
    expect(w.map((x) => x.index)).toEqual([0, 1]);
    expect(w[0].sig).toBe(sigOf(A, B, 'walking'));
    expect(sigOf(A, B, 'walking')).not.toBe(sigOf(A, B, 'cycling'));
    expect(sigOf(A, B, 'walking')).not.toBe(sigOf(B, A, 'walking'));
    expect(sigOf(A, B, 'walking')).toBe(sigOf([A[0] + 1e-9, A[1]], B, 'walking')); // the same click to about 10 cm
  });
  it('pending legs are still wanted (an undo can bring one back with its request long gone), routed ones are not', () => {
    let r = three();
    r = markPending(r, new Set([sigOf(A, B, 'walking')]));
    expect(r.legs.map((l) => l.state)).toEqual(['pending', 'stale']);
    expect(wanted(r).map((x) => x.index)).toEqual([0, 1]);
    r = applyLeg(r, sigOf(A, B, 'walking'), road(A, B));
    expect(r.legs.map((l) => l.state)).toEqual(['routed', 'stale']);
    expect(wanted(r).map((x) => x.index)).toEqual([1]);
  });
  it('an answer only goes to the legs it was for, and an answer for a leg that has gone is ignored', () => {
    const r = three();
    expect(applyLeg(r, sigOf(A, D, 'walking'), road(A, D))).toBe(r);
    const moved = moveWaypoint(r, 1, [153.01, -27.5]);
    expect(applyLeg(moved, sigOf(A, B, 'walking'), road(A, B)).legs[0].state).toBe('held'); // B moved: that road is not for this leg
  });
  it('the same two clicks twice in a route are both filled by one answer', () => {
    const r = outAndBack(three(null))!; // reversed legs are separate legs with their own identity
    expect(r.legs).toHaveLength(4);
    const loop = addWaypoint(addWaypoint(addWaypoint(startRoute(A), B, 'walking'), A, 'walking'), B, 'walking'); // A-B, B-A, A-B
    const done = applyLeg(loop, sigOf(A, B, 'walking'), road(A, B));
    expect(done.legs.map((l) => l.state)).toEqual(['routed', 'stale', 'routed']);
  });
});

describe('the drawn route', () => {
  it('while nothing is routed it is the straight lines between the clicks', () => {
    expect(linesOf(three())).toEqual([[A, B, C]]);
  });
  it('once routed it follows the roads, and a waypoint is drawn where the road is, not where it was clicked', () => {
    const r = routeAll(three());
    const line = linesOf(r)[0];
    expect(line.length).toBeGreaterThan(3);
    expect(anchorOf(r, 1)).toEqual(r.legs[0].line.at(-1));
    expect(anchorOf(r, 0)).toEqual(r.legs[0].line[0]);
    expect(lineKm(line)).toBeGreaterThan(lineKm([A, B, C]));
  });
  it('a single waypoint is just a start marker', () => {
    expect(linesOf(startRoute(A))).toEqual([[A]]);
    expect(linesOf({ wps: [], legs: [] })).toEqual([]);
  });
  it('the joint between two routed legs is not doubled', () => {
    const line = linesOf(routeAll(three()))[0];
    for (let i = 1; i < line.length; i += 1) expect(line[i][0] !== line[i - 1][0] || line[i][1] !== line[i - 1][1]).toBe(true);
  });
});

describe('moving a waypoint', () => {
  it('turns the two legs beside it into held straight lines, and leaves the others alone', () => {
    const r = routeAll(three());
    const m = moveWaypoint(r, 1, [153.002, -27.502]);
    expect(m.wps[1]).toEqual([153.002, -27.502]);
    expect(m.legs.map((l) => l.state)).toEqual(['held', 'held']);
    expect(m.legs[0].line.at(-1)).toEqual([153.002, -27.502]);
    expect(wanted(m)).toEqual([]); // nothing is asked for while it is being dragged
  });
  it('an end waypoint has only one leg beside it', () => {
    const m = moveWaypoint(routeAll(three()), 0, [153.0, -27.49]);
    expect(m.legs.map((l) => l.state)).toEqual(['held', 'routed']);
  });
  it('releasing routes the held legs again; straight legs stay straight', () => {
    const r = releaseHeld(moveWaypoint(routeAll(three()), 1, [153.002, -27.502]));
    expect(r.legs.map((l) => l.state)).toEqual(['stale', 'stale']);
    expect(wanted(r)).toHaveLength(2);
    const s = releaseHeld(moveWaypoint(three(null), 1, [153.002, -27.502]));
    expect(s.legs.map((l) => l.state)).toEqual(['straight', 'straight']);
  });
  it('ignores a waypoint that does not exist', () => {
    const r = three();
    expect(moveWaypoint(r, 9, A)).toBe(r);
  });
});

describe('adding and deleting waypoints on a route', () => {
  it('a point added in the middle of a leg splits it in two, each routed again the same way', () => {
    const r = insertWaypoint(routeAll(three('walking')), 0, [153.002, -27.499]);
    expect(r.wps).toHaveLength(4);
    expect(r.wps[1]).toEqual([153.002, -27.499]);
    expect(r.legs.map((l) => l.state)).toEqual(['stale', 'stale', 'routed']);
    expect(r.legs.every((l) => l.profile === 'walking')).toBe(true);
    expect(wanted(r).map((w) => w.sig)).toEqual([sigOf(A, [153.002, -27.499], 'walking'), sigOf([153.002, -27.499], B, 'walking')]);
  });
  it('a point added while being dragged holds its two legs until release (no road is asked for at the place it started)', () => {
    const r = insertWaypoint(routeAll(three('walking')), 0, [153.002, -27.499], true);
    expect(r.legs.map((l) => l.state)).toEqual(['held', 'held', 'routed']);
    expect(wanted(r)).toEqual([]);
    expect(wanted(releaseHeld(r))).toHaveLength(2);
  });
  it('a straight leg stays straight when split', () => {
    const r = insertWaypoint(three(null), 1, [153.004, -27.502]);
    expect(r.legs.map((l) => l.state)).toEqual(['straight', 'straight', 'straight']);
  });
  it('deleting an inner waypoint joins its two legs into one, to be routed again', () => {
    const r = deleteWaypoint(routeAll(three()), 1)!;
    expect(r.wps).toEqual([A, C]);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].state).toBe('stale');
    expect(r.legs[0].line).toEqual([A, C]);
  });
  it('deleting an end waypoint just drops its leg', () => {
    const r = routeAll(three());
    expect(deleteWaypoint(r, 2)!.wps).toEqual([A, B]);
    expect(deleteWaypoint(r, 2)!.legs).toHaveLength(1);
    expect(deleteWaypoint(r, 0)!.wps).toEqual([B, C]);
    expect(deleteWaypoint(r, 0)!.legs[0].state).toBe('routed');
  });
  it('a route keeps at least two waypoints', () => {
    const two = addWaypoint(startRoute(A), B, 'walking');
    expect(deleteWaypoint(two, 0)).toBeNull();
    expect(deleteWaypoint(three(), 9)).toBeNull();
  });
  it('merging a roads leg with a straight leg keeps wanting roads', () => {
    const mixed = addWaypoint(addWaypoint(startRoute(A), B, null), C, 'walking');
    expect(deleteWaypoint(mixed, 1)!.legs[0].profile).toBe('walking');
  });
});

describe('return to start and out and back', () => {
  it('return to start adds one more leg back to the first waypoint, routed the same way', () => {
    const r = closeLoop(routeAll(three()), 'walking')!;
    expect(r.wps).toEqual([A, B, C, A]);
    expect(r.legs.at(-1)!.state).toBe('stale');
    expect(wanted(r)[0].sig).toBe(sigOf(C, A, 'walking'));
  });
  it('and with Follow roads off, a straight leg', () => {
    expect(closeLoop(three(), null)!.legs.at(-1)!.state).toBe('straight');
  });
  it('refuses when the route already ends where it began, or has no leg', () => {
    const loop = addWaypoint(addWaypoint(startRoute(A), B, 'walking'), A, 'walking');
    expect(closeLoop(loop, 'walking')).toBeNull();
    expect(closeLoop(startRoute(A), 'walking')).toBeNull();
  });
  it('out and back mirrors the waypoints and the legs, keeping what was routed', () => {
    const r = outAndBack(routeAll(three()))!;
    expect(r.wps).toEqual([A, B, C, B, A]);
    expect(r.legs).toHaveLength(4);
    expect(r.legs.map((l) => l.state)).toEqual(['routed', 'routed', 'routed', 'routed']);
    expect(r.legs[2].line).toEqual(r.legs[1].line.slice().reverse());
    expect(r.legs[3].line).toEqual(r.legs[0].line.slice().reverse());
    expect(lineKm(linesOf(r)[0])).toBeCloseTo(lineKm(linesOf(routeAll(three()))[0]) * 2, 2);
  });
  it('out and back wants an unrouted leg routed in the new direction', () => {
    const r = outAndBack(three())!;
    expect(wanted(r).map((w) => w.sig)).toContain(sigOf(C, B, 'walking'));
  });
  it('out and back needs a leg', () => {
    expect(outAndBack(startRoute(A))).toBeNull();
  });
});

describe('failing, retrying and counting', () => {
  it('a failed leg stays a straight line and is counted; retrying makes it wanted again', () => {
    let r = markPending(three(), new Set([sigOf(A, B, 'walking'), sigOf(B, C, 'walking')]));
    r = failLeg(r, sigOf(A, B, 'walking'));
    r = applyLeg(r, sigOf(B, C, 'walking'), road(B, C));
    expect(r.legs.map((l) => l.state)).toEqual(['failed', 'routed']);
    expect(counts(r)).toEqual({ waiting: 0, failed: 1, routed: 1, straight: 0 });
    expect(wanted(r)).toEqual([]);
    expect(linesOf(r)[0].slice(0, 2)).toEqual([A, r.legs[1].line[0]]);
    const again = retryFailed(r);
    expect(again.legs[0].state).toBe('stale');
    expect(wanted(again)).toHaveLength(1);
    const untouched = three();
    expect(retryFailed(untouched)).toBe(untouched); // nothing failed: nothing changes
  });
  it('counts waiting (stale, pending, held), failed, routed and straight legs', () => {
    expect(counts(three())).toEqual({ waiting: 2, failed: 0, routed: 0, straight: 0 });
    expect(counts(routeAll(three()))).toEqual({ waiting: 0, failed: 0, routed: 2, straight: 0 });
    expect(counts(three(null))).toEqual({ waiting: 0, failed: 0, routed: 0, straight: 2 });
    expect(counts(moveWaypoint(routeAll(three()), 1, D)).waiting).toBe(2);
  });
  it('a late failure for a leg that is no longer waiting changes nothing', () => {
    const r = routeAll(three());
    expect(failLeg(r, sigOf(A, B, 'walking'))).toBe(r);
  });
});

describe('the middle of a leg and what a press grabs', () => {
  it('midOfLine is half way along the path, not half way between the ends', () => {
    const l: Line = [[0, 0], [0, 0.01], [0.001, 0.01]]; // up 1.1 km then right 0.11 km
    const mid = midOfLine(l);
    expect(mid[0]).toBe(0); // still on the long first part
    expect(mid[1]).toBeCloseTo(0.0055, 4); // half of the 1.22 km is 0.61 km up
    expect(midOfLine([[1, 1]])).toEqual([1, 1]);
  });
  const flat = ([x, y]: Pos) => ({ x: x * 20000, y: -y * 20000 }); // 20,000 px per degree: a 0.004 degree leg is 80 px
  it('a waypoint within reach is grabbed (at the road, where it is drawn)', () => {
    const r = routeAll(three());
    const p = flat(anchorOf(r, 1));
    expect(hitTestSnap(r, flat, { x: p.x + 4, y: p.y - 3 }, 14)).toEqual({ kind: 'vertex', wi: 1 });
  });
  it('else the middle dot of a long-enough leg, which is on the road', () => {
    const r = routeAll(three());
    const hit = hitTestSnap(r, flat, flat(midOfLine(legLine(r, 0))), 14);
    expect(hit?.kind).toBe('mid');
    expect(hit && hit.kind === 'mid' ? hit.li : -1).toBe(0);
  });
  it('a leg too short on screen has no middle dot, and mids can be switched off', () => {
    const r = routeAll(three());
    const tiny = ([x, y]: Pos) => ({ x: x * 2000, y: -y * 2000 });
    expect(hitTestSnap(r, tiny, tiny(midOfLine(legLine(r, 0))), 3)).toBeNull(); // 8 px legs: no middle dot, and the ends are further than 3 px away
    expect(hitTestSnap(r, flat, flat(midOfLine(legLine(r, 0))), 14, 28, false)).toBeNull();
  });
  it('nothing near means nothing', () => {
    expect(hitTestSnap(routeAll(three()), flat, { x: -500, y: -500 }, 14)).toBeNull();
  });
});
