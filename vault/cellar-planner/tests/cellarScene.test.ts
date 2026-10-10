import { describe, expect, it } from 'vitest';
import { analyseApp, fullRuns } from '../src/app/model';
import { buildScene, makeCamera } from '../src/lite/cellarScene';
import { BOTTLES, WALLS, defaultLite, liteResult, type LiteSettings } from '../src/lite/settings';

const sceneFor = (s: LiteSettings, yawDeg = 0) => {
  const r = liteResult(s);
  const a = analyseApp(r.project);
  const runs = fullRuns(r.project);
  return { r, a, runs, scene: buildScene({ project: r.project, runs, analysis: a.racks, yawDeg }) };
};

describe('the pinhole camera', () => {
  it('puts the point it looks at in the middle of the picture', () => {
    const cam = makeCamera([0, 5000, 2000], [0, 0, 500], 1000)!;
    const p = cam([0, 0, 500])!;
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.y)).toBeLessThan(1e-6);
  });
  it('puts things to the right of centre on the right of the picture, and higher things higher up', () => {
    const cam = makeCamera([0, 5000, 2000], [0, 0, 500], 1000);
    expect(cam([500, 0, 500])!.x).toBeGreaterThan(0);
    expect(cam([0, 0, 1500])!.y).toBeLessThan(cam([0, 0, 500])!.y); // screen y is downward
  });
  it('makes nearer things bigger', () => {
    const cam = makeCamera([0, 5000, 2000], [0, 0, 500], 1000);
    const far = cam([500, 0, 500])!, near = cam([500, 3000, 500])!;
    expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(far.x));
  });
  it('gives nothing for a point behind the camera', () => {
    expect(makeCamera([0, 5000, 2000], [0, 0, 500], 1000)([0, 9000, 500])).toBeNull();
  });
});

describe('the cellar scene', () => {
  it('draws the floor and the three walls, far to near', () => {
    const { scene } = sceneFor(defaultLite());
    const ids = scene.faces.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['floor', 'wall-far', 'wall-left', 'wall-right']));
    for (let i = 1; i < scene.faces.length; i++) expect(scene.faces[i - 1].depth).toBeGreaterThanOrEqual(scene.faces[i].depth);
  });

  it('shows exactly the bottles whose rack faces the visitor: everything except racks on the door wall', () => {
    for (const wall of WALLS) {
      const { r, a, runs, scene } = sceneFor({ ...defaultLite(), doorWall: wall });
      const onDoorWall = runs.filter((x) => x.wall === wall).reduce((n, run) => { const c = a.racks.runs.find((q) => q.runId === run.id)?.capacity; return n + (c && c.status === 'OK' ? c.capacity : 0); }, 0);
      expect(scene.stats.bottles, `door on ${wall}`).toBe(r.bottles - onDoorWall);
    }
  });

  it('counts every rack that has a size, and none that do not', () => {
    const { runs, scene } = sceneFor(defaultLite());
    expect(scene.stats.racks).toBe(runs.length);
  });

  it('always has finite, usable numbers, for every door wall, bottle style, door style and room size at the limits', () => {
    for (const doorWall of WALLS) for (const bottle of BOTTLES) for (const doorStyle of ['SINGLE', 'DOUBLE'] as const) {
      for (const [widthMm, depthMm, heightMm] of [[1000, 1000, 2000], [8000, 8000, 3200], [2750, 1565, 2150], [1800, 6000, 2400]]) {
        const { scene } = sceneFor({ ...defaultLite(), doorWall, bottle, doorStyle, widthMm, depthMm, heightMm });
        const b = scene.bounds;
        expect([b.x0, b.y0, b.x1, b.y1].every(Number.isFinite), `${doorWall} ${bottle} ${doorStyle} ${widthMm}x${depthMm}x${heightMm}`).toBe(true);
        expect(b.x1).toBeGreaterThan(b.x0);
        for (const f of scene.faces) expect(f.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
        for (const bt of scene.bottles) expect([bt.x, bt.y, bt.rx, bt.ry, bt.depth].every(Number.isFinite)).toBe(true);
      }
    }
  }, 60000);

  it('turning the view is limited to 40 degrees each way', () => {
    const a = sceneFor(defaultLite(), 40).scene, b = sceneFor(defaultLite(), 90).scene, c = sceneFor(defaultLite(), -90).scene, d = sceneFor(defaultLite(), -40).scene;
    expect(b.bounds).toEqual(a.bounds);
    expect(c.bounds).toEqual(d.bounds);
    expect(sceneFor(defaultLite(), 0).scene.bounds).not.toEqual(a.bounds);
  });

  it('draws a bottle in front of the rack it sits in (it is drawn straight after that rack\'s front)', () => {
    const { scene } = sceneFor(defaultLite());
    const fronts = scene.faces.filter((f) => f.kind === 'rackFront').map((f) => f.depth);
    for (const bt of scene.bottles) expect(fronts.some((d) => Math.abs(d - 0.5 - bt.depth) < 1e-6)).toBe(true);
  });

  it('has no more bottles on screen than the design holds', () => {
    const { r, scene } = sceneFor({ ...defaultLite(), widthMm: 8000, depthMm: 8000 });
    expect(scene.stats.bottles).toBeLessThanOrEqual(r.bottles);
  });

  it('is quick enough to redraw while the visitor drags (the biggest room)', () => {
    const { r, a, runs } = sceneFor({ ...defaultLite(), widthMm: 8000, depthMm: 8000, bottle: 'BORDEAUX' });
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) buildScene({ project: r.project, runs, analysis: a.racks, yawDeg: i - 10 });
    expect((performance.now() - t0) / 20).toBeLessThan(120);
  });
});
