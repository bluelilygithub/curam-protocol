import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LITE_TOUR_KEY, LITE_TOUR_STEPS } from '../src/lite/liteTour';
import { analyseApp, deserializeApp, serializeApp } from '../src/app/model';
import { findDesignCode, projectFromCode } from '../src/ui/CodeModal';
import { BOTTLES, LITE_UNIT_WIDTH_MM, WALLS, decodeDesign, defaultLite, encodeDesign, liteResult, liteToProject, normaliseLite, summaryLine, type LiteSettings } from '../src/lite/settings';

const bottlesOf = (s: LiteSettings): number => liteResult(s).bottles;

describe('lite design code', () => {
  it('round-trips every setting', () => {
    for (const bottle of BOTTLES) for (const doorWall of WALLS) {
      for (const doorStyle of ['SINGLE', 'DOUBLE'] as const) {
      const s: LiteSettings = { widthMm: 3100, depthMm: 2200, heightMm: 2400, doorWall, doorStyle, bottle, mode: 'TARGET', target: 321 };
      expect(decodeDesign(encodeDesign(s))).toEqual(s);
    }
    }
  });
  it('is short, versioned, and carries settings only', () => {
    const code = encodeDesign(defaultLite());
    expect(code).toMatch(/^CL1\.[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(60);
  });
  it('rejects text that is not a code, a newer version, and malformed bodies', () => {
    for (const bad of ['', 'hello', 'CL2.WzEsMl0', 'CL1.', 'CL1.@@@', 'CL1.' + btoa('{"a":1}'), 'CL1.' + btoa('[1,2,3]'), 'CL1.' + btoa('["a",1,1,1,1,1,1]')]) expect(decodeDesign(bad)).toBeNull();
  });
  it('clamps out-of-range values instead of trusting them', () => {
    const n = normaliseLite({ ...defaultLite(), widthMm: 1, depthMm: 999999, heightMm: NaN, target: -5 });
    expect(n.widthMm).toBe(1000); expect(n.depthMm).toBe(8000); expect(n.heightMm).toBe(2000); expect(n.target).toBe(1);
  });
  it('trims whitespace around a pasted code', () => {
    expect(decodeDesign(`  ${encodeDesign(defaultLite())}\n`)).toEqual(defaultLite());
  });
});

describe('lite design to project', () => {
  it('fills the walls with an estimate and no errors for the default room', () => {
    const r = liteResult(defaultLite());
    expect(r.problems).toEqual([]);
    expect(r.bottles).toBeGreaterThan(0);
    expect(r.project.estimated?.length).toBeGreaterThan(0);
    expect(r.project.walkwayMm).toBeNull();
  });
  it('builds a valid room at every door wall and bottle style, without errors', () => {
    for (const bottle of BOTTLES) for (const doorWall of WALLS) {
      const r = liteResult({ ...defaultLite(), bottle, doorWall });
      expect(r.problems, `${doorWall} ${bottle}`).toEqual([]);
    }
  });
  it('a bigger room never holds fewer bottles', () => {
    expect(bottlesOf({ ...defaultLite(), widthMm: 3600 })).toBeGreaterThanOrEqual(bottlesOf(defaultLite()));
  });
  it('a target gives the smallest layout that still reaches it, never more than the full fill', () => {
    const full = liteResult(defaultLite()).bottles;
    const target = Math.floor(full / 2);
    const r = liteResult({ ...defaultLite(), mode: 'TARGET', target });
    expect(r.bottles).toBeGreaterThanOrEqual(target);
    expect(r.bottles).toBeLessThan(target + 120);
    expect(r.maxBottles).toBe(full);
    expect(liteResult({ ...defaultLite(), mode: 'TARGET', target: full + 500 }).bottles).toBe(full);
  });
  it('survives the smallest and the largest room', () => {
    for (const [widthMm, depthMm, heightMm] of [[1000, 1000, 2000], [8000, 8000, 3200]]) {
      const r = liteResult({ ...defaultLite(), widthMm, depthMm, heightMm });
      expect(Number.isFinite(r.bottles)).toBe(true);
    }
  });
  it('the summary line says estimate only', () => {
    expect(summaryLine(defaultLite(), 480)).toMatch(/estimate only/);
  });
});

describe('round trip: lite settings -> code -> full planner', () => {
  it('gives the same enclosure, runs and bottle total', () => {
    const s: LiteSettings = { widthMm: 3300, depthMm: 2000, heightMm: 2300, doorWall: 'WEST', doorStyle: 'DOUBLE', bottle: 'BURGUNDY', mode: 'TARGET', target: 400 };
    const fromLite = liteToProject(s);
    const fromCode = liteToProject(decodeDesign(encodeDesign(s)) as LiteSettings);
    expect(fromCode).toEqual(fromLite);
    // and as a saved file the full planner opens
    const reopened = deserializeApp(serializeApp(fromCode));
    expect(reopened.enclosure).toEqual(fromLite.enclosure);
    expect(reopened.runs).toEqual(fromLite.runs);
    expect(analyseApp(reopened).racks.total).toEqual(analyseApp(fromLite).racks.total);
  });
});

describe('staff side: open from design code', () => {
  const s = { ...defaultLite(), widthMm: 3000, doorWall: 'EAST' as const };
  it('finds the code in a bare code, a labelled line, or a whole email', () => {
    const code = encodeDesign(s);
    for (const text of [code, `Design code: ${code}`, `Hi,
Inside 3000 x 1565 x 2150 mm [Design code: ${code}]
Thanks`]) expect(findDesignCode(text)).toBe(code);
  });
  it('opens the same project the visitor saw', () => {
    const r = projectFromCode(`Design code: ${encodeDesign(s)}`);
    expect('project' in r && r.project).toEqual(liteToProject(s));
  });
  it('says why when it cannot open', () => {
    expect('error' in projectFromCode('no code here')).toBe(true);
    expect('error' in projectFromCode('CL9.WzEsMl0')).toBe(true);
  });
});

describe('lite help: tour and guide', () => {
  const screen = readFileSync('src/lite/LiteApp.tsx', 'utf8');
  const guide = readFileSync('src/lite/LiteHelp.tsx', 'utf8');
  it('has unique step ids, a welcome and a finish, and a title and text on every step', () => {
    const ids = LITE_TOUR_STEPS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LITE_TOUR_STEPS[0].id).toBe('lt-welcome');
    expect(LITE_TOUR_STEPS[LITE_TOUR_STEPS.length - 1].id).toBe('lt-done');
    for (const x of LITE_TOUR_STEPS) { expect(x.title.length).toBeGreaterThan(3); expect(x.text.length).toBeGreaterThan(40); }
    expect(LITE_TOUR_KEY).toMatch(/^cellar-lite:/);
  });
  it('every step that points at something points at a hook that exists on the screen', () => {
    for (const x of LITE_TOUR_STEPS) if (x.target) expect(screen, x.target).toContain(`data-tour="${x.target}"`);
  });
  it('walks the questions in the order the screen asks them, then the result, drawings and quote', () => {
    const order = LITE_TOUR_STEPS.filter((x) => x.target).map((x) => x.target);
    expect(order).toEqual(['lt-size', 'lt-door', 'lt-bottle', 'lt-mode', 'lt-result', 'lt-drawing', 'lt-quote']);
  });
  it('says in plain words that the figures are an estimate, not a quote', () => {
    const all = LITE_TOUR_STEPS.map((x) => x.text).join(' ') + guide;
    expect(all).toMatch(/estimate only, not a quote/i);
    expect(guide).toMatch(/not a quote or a building plan/i);
  });
  it('explains every term the screen uses, without jargon', () => {
    for (const term of ['Inside width, depth and height', 'Door on the', 'Door type', 'Main bottle style', 'How many bottles', 'Plan from above', 'Racks on a wall', 'Request a quote']) expect(guide, term).toContain(term);
    for (const jargon of ['elevation', 'run ', 'build-up', 'header', 'label-forward', 'HVAC']) expect(guide.toLowerCase(), jargon).not.toContain(jargon.toLowerCase());
  });
  it('shows the explanations without hovering (visible hints, no tooltip dependence)', () => {
    expect(screen).toMatch(/field-hint/);
    expect(readFileSync('src/lite/lite.css', 'utf8')).toMatch(/\.lite \.field-hint \{ display: block/);
  });
});

describe('plan labels', () => {
  it('lite labels every rack region with its bottle count, in plain words, and offers a shorter text for small ones', async () => {
    const { planView, badRunIds } = await import('../src/views');
    const { analyseApp, fullRuns } = await import('../src/app/model');
    const p = liteToProject(defaultLite());
    const a = analyseApp(p);
    const racks = planView(p.enclosure, fullRuns(p), a.racks, { walkwayMm: null, badRuns: badRunIds(a.racks.issues), plainLabels: true }).filter((x) => x.kind === 'rect' && x.tone === 'rack');
    expect(racks).toHaveLength(5);
    for (const r of racks) {
      if (r.kind !== 'rect') continue;
      expect(r.label).toMatch(/^\d+ bottles$/);
      expect(r.shortLabels).toEqual([String(r.label).replace(' bottles', '')]);
    }
  });
  it('the full planner says "1 unit", not "1 units"', async () => {
    const { planView } = await import('../src/views');
    const { analyseApp, fullRuns } = await import('../src/app/model');
    const p = liteToProject(defaultLite());
    const a = analyseApp(p);
    const labels = planView(p.enclosure, fullRuns(p), a.racks).flatMap((x) => (x.kind === 'rect' && x.tone === 'rack' ? [x.label] : []));
    expect(labels.some((l) => /: 1 unit,/.test(String(l)))).toBe(true);
    expect(labels.some((l) => /1 units/.test(String(l)))).toBe(false);
  });
});

describe('standard rack units are stated', () => {
  const screen = readFileSync('src/lite/LiteApp.tsx', 'utf8');
  const guide = readFileSync('src/lite/LiteHelp.tsx', 'utf8');
  const tour = LITE_TOUR_STEPS.map((x) => x.text).join(' ');
  it('says so on the screen, in the guide, in the tour and in the enquiry line', () => {
    expect(screen).toMatch(/standard-size rack units/);
    expect(guide).toMatch(/standard-size rack units/);
    expect(tour).toMatch(/standard-size rack units/);
    expect(summaryLine(defaultLite(), 480)).toMatch(/standard rack units about 600 mm wide/);
  });
  it('the guide explains the gaps and that exact sizes are confirmed with the supplier', () => {
    expect(guide).toMatch(/gap/i);
    expect(guide).toMatch(/confirmed with the rack supplier/);
  });
  it('the width it states is the width the layout really uses', () => {
    const p = liteToProject(defaultLite());
    expect(p.rackSpec.unitWidthMm).toBe(LITE_UNIT_WIDTH_MM);
  });
});

describe('single and double doors', () => {
  it('a single door is one 970 mm leaf and a double door is two leaves filling a 1500 mm opening', () => {
    expect(liteToProject(defaultLite()).enclosure.door).toMatchObject({ widthMm: 970 });
    expect(liteToProject(defaultLite()).enclosure.door.leaves).toBeUndefined();
    expect(liteToProject({ ...defaultLite(), doorStyle: 'DOUBLE' }).enclosure.door).toMatchObject({ widthMm: 1500, leaves: 2 });
  });
  it('a double door builds without errors on every wall, and on the smallest room the opening shrinks to fit', () => {
    for (const doorWall of WALLS) expect(liteResult({ ...defaultLite(), doorWall, doorStyle: 'DOUBLE' }).problems, doorWall).toEqual([]);
    const small = liteToProject({ ...defaultLite(), widthMm: 1000, depthMm: 1000, doorStyle: 'DOUBLE' });
    expect(small.enclosure.door.widthMm).toBeLessThanOrEqual(1100 - 200);
    expect(small.enclosure.door.widthMm % 2).toBe(0);
  });
  it('a wider opening leaves less wall for racks, so a double door never holds more bottles than a single', () => {
    expect(liteResult({ ...defaultLite(), doorStyle: 'DOUBLE' }).bottles).toBeLessThanOrEqual(liteResult(defaultLite()).bottles);
  });
  it('codes made before double doors existed (seven values) still open, as single doors', () => {
    const old = 'CL1.' + btoa(JSON.stringify([2750, 1565, 2150, 2, 0, 0, 500])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeDesign(old)).toMatchObject({ widthMm: 2750, doorStyle: 'SINGLE' });
  });
  it('the summary line says which door', () => {
    expect(summaryLine({ ...defaultLite(), doorStyle: 'DOUBLE' }, 100)).toMatch(/double door/);
    expect(summaryLine(defaultLite(), 100)).toMatch(/single door/);
  });
});
