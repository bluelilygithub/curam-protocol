import { describe, expect, it } from 'vitest';
import { analyseApp, fullRuns, sampleProject, testCaseProject } from '../src/app/model';
import { dragGhost, planRunHits, planView, wallEndName, wallStartName } from '../src/views';

const p = testCaseProject();
const a = analyseApp(p);
const runs = fullRuns(p);

describe('where a run can be picked up on the plan', () => {
  const hits = planRunHits(p.enclosure, runs, a.racks);
  it('has one area per run that has a size, with its plan rectangle', () => {
    expect(hits.map((h) => h.id).sort()).toEqual(['east-1', 'north-1', 'south-1', 'south-2', 'west-1']);
    const n = hits.find((h) => h.id === 'north-1')!;
    // inside north-west corner is at (50, 50) on the plan; the north run is 4 x 600 long and 350 deep
    expect([n.x, n.y, n.w, n.h]).toEqual([50, 50, 2400, 350]);
    const w = hits.find((h) => h.id === 'west-1')!;
    expect([w.x, w.y, w.w, w.h]).toEqual([50, 400, 350, 600]);
  });
  it('matches the rectangles the plan itself draws for the runs', () => {
    const rects = planView(p.enclosure, runs, a.racks).filter((q) => q.kind === 'rect' && (q.tone === 'rack' || q.tone === 'rackIssue')) as Array<{ x: number; y: number; w: number; h: number }>;
    for (const h of hits) expect(rects.some((r) => r.x === h.x && r.y === h.y && r.w === h.w && r.h === h.h), h.id).toBe(true);
    expect(rects).toHaveLength(hits.length);
  });
  it('the tip says what it is, where it starts and how to move it', () => {
    const t = hits.find((h) => h.id === 'north-1')!.tip;
    expect(t).toMatch(/^north-1: 4 units, 560 bottles\./); expect(t).toContain('Starts 0 mm from the west end of the north wall'); expect(t).toContain('Drag it along the wall');
    expect(planRunHits(p.enclosure, runs, a.racks, new Set(['north-1'])).find((h) => h.id === 'north-1')!.tip).toContain('not counted (has an error)');
    expect(hits.find((h) => h.id === 'west-1')!.tip).toContain('from the north end of the west wall');
  });
  it('a run with no size has no pick-up area', () => {
    const blank = { ...sampleProject(), runs: [{ id: 'run-1', wall: 'NORTH' as const, startMm: 0, units: 2 }] };
    expect(planRunHits(blank.enclosure, fullRuns(blank), analyseApp(blank).racks)).toEqual([]);
  });
  it('the topmost (last drawn) run is first, so it wins where two overlap', () => {
    expect(hits[0]!.id).toBe('east-1');
  });
});

describe('the outline while dragging', () => {
  const north = runs.find((r) => r.id === 'north-1')!;
  it('is the run where it would land, dashed, in the rack tone when allowed and red when not', () => {
    const ok = dragGhost(p.enclosure, north, 200, { ok: true, snap: null });
    expect(ok[0]).toMatchObject({ kind: 'rect', x: 250, y: 50, w: 2400, h: 350, tone: 'rack', dash: true });
    const bad = dragGhost(p.enclosure, north, 200, { ok: false, snap: null, reason: 'too close' });
    expect(bad[0]).toMatchObject({ tone: 'rackIssue' });
  });
  it('says how far it is from each end of its wall, and what it snaps to', () => {
    const t = (dragGhost(p.enclosure, north, 350, { ok: true, snap: 'the end of the wall' })[1] as { text: string }).text;
    expect(t).toBe('350 mm from the west end · 0 mm to the east end · snaps to the end of the wall');
  });
  it('gives the reason when the place is not allowed', () => {
    const t = (dragGhost(p.enclosure, north, 100, { ok: false, snap: null, reason: 'This run overlaps west-1.' })[1] as { text: string }).text;
    expect(t).toContain('This run overlaps west-1.');
  });
  it('names the right ends for east and west walls, and puts the caption in the room', () => {
    const west = runs.find((r) => r.id === 'west-1')!;
    const g = dragGhost(p.enclosure, west, 400, { ok: true, snap: null });
    expect((g[1] as { text: string }).text).toBe('400 mm from the north end · 565 mm to the south end');
    expect((g[1] as { anchor: string }).anchor).toBe('start');
    expect((g[1] as { x: number }).x).toBeGreaterThan((g[0] as { x: number; w: number }).x + (g[0] as { w: number }).w);
    const east = runs.find((r) => r.id === 'east-1')!;
    expect((dragGhost(p.enclosure, east, 400, { ok: true, snap: null })[1] as { anchor: string }).anchor).toBe('end');
    expect([wallStartName('SOUTH'), wallEndName('SOUTH'), wallStartName('EAST'), wallEndName('EAST')]).toEqual(['west', 'east', 'north', 'south']);
  });
  it('along the north and south walls the caption starts at the edge with more room, so it never runs over a wall', () => {
    const south = runs.find((r) => r.id === 'south-1')!;
    const near = dragGhost(p.enclosure, south, 100, { ok: true, snap: null })[1] as { anchor: string; x: number };
    expect(near.anchor).toBe('start'); expect(near.x).toBe(150);
    const far = dragGhost(p.enclosure, south, 2000, { ok: true, snap: null })[1] as { anchor: string; x: number };
    expect(far.anchor).toBe('end'); expect(far.x).toBe(50 + 2000 + 600);
  });
  it('is empty for a run with no size', () => {
    const blank = { ...sampleProject(), runs: [{ id: 'run-1', wall: 'NORTH' as const, startMm: 0, units: 2 }] };
    expect(dragGhost(blank.enclosure, fullRuns(blank)[0]!, 0, { ok: true, snap: null })).toEqual([]);
  });
});
