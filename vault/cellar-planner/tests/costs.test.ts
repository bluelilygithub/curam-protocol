import { describe, expect, it } from 'vitest';
import { applyRackType, glassWallAreaM2, staffPrice, type Catalogue } from '../src/app/catalogue';
import { testCaseProject, type AppProject } from '../src/app/model';
import { DEFAULT_CONFIG, normaliseConfig, type CostSettings, type RackType } from '../src/lite/config';
import { quoteBlockers } from '../src/export/quote';
import { wallLengthMm } from '../src/enclosure/enclosure';
import { NO_COSTS } from './_costs';

const T: RackType = { ...DEFAULT_CONFIG.rackTypes[0]!, id: 'std', name: 'Standard 600', unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true };
const QUOTE = { ...DEFAULT_CONFIG.quote, businessName: 'Acme Wine Cellars' };
const cat = (costs: CostSettings): Catalogue => ({
  rackTypes: [T], defaultRackType: 'std', doors: { singleMm: 970, doubleMm: 1500 },
  pricing: { ...DEFAULT_CONFIG.pricing, fixed: 2000, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100 }, quote: QUOTE, cooling: { ...DEFAULT_CONFIG.cooling }, costs, features: [],
});
const design = (): AppProject => applyRackType(testCaseProject(), T);
const confirmed = (c: CostSettings): CostSettings => ({
  glassPerM2: { ...c.glassPerM2, confirmed: true }, cooling: { ...c.cooling, confirmed: true }, lighting: { ...c.lighting, confirmed: true }, installation: { ...c.installation, confirmed: true },
  margin: { ...c.margin, confirmed: true },
});

describe('the other costs of a job', () => {
  it('start as placeholders, in the settings the browser and the server agree on', () => {
    const c = DEFAULT_CONFIG.costs;
    for (const line of [c.glassPerM2, c.cooling, c.lighting, c.installation]) { expect(line.amount).toBeGreaterThan(0); expect(line.confirmed).toBe(false); }
    expect(c.margin.pct).toBeGreaterThan(0); expect(c.margin.confirmed).toBe(false);
  });

  it('measures the glass wall in square metres, without the door opening, and is zero when no wall is glass', () => {
    const p = design();
    const walls = p.enclosure.walls;
    const allWall = { ...p, enclosure: { ...p.enclosure, walls: { NORTH: { ...walls.NORTH, kind: 'PANEL' as const }, EAST: { ...walls.EAST, kind: 'PANEL' as const }, SOUTH: { ...walls.SOUTH, kind: 'PANEL' as const }, WEST: { ...walls.WEST, kind: 'PANEL' as const } } } };
    expect(glassWallAreaM2(allWall as AppProject)).toBe(0);
    const oneGlass = { ...allWall, enclosure: { ...allWall.enclosure, walls: { ...allWall.enclosure.walls, NORTH: { ...allWall.enclosure.walls.NORTH, kind: 'GLASS' as const } } } } as AppProject;
    const e = oneGlass.enclosure;
    const north = (wallLengthMm(e, 'NORTH') * e.heightMm) / 1e6;
    const doorOnNorth = e.door.wall === 'NORTH' ? (e.door.widthMm * Math.min(e.door.heightMm, e.heightMm)) / 1e6 : 0;
    expect(glassWallAreaM2(oneGlass)).toBeCloseTo(Math.round((north - doorOnNorth) * 100) / 100, 2);
  });

  it('adds a line for each cost, marks the unconfirmed ones as placeholders, and puts the margin on top of everything', () => {
    const costs: CostSettings = { glassPerM2: { amount: 1000, confirmed: false }, cooling: { amount: 5000, confirmed: false }, lighting: { amount: 1000, confirmed: true }, installation: { amount: 3000, confirmed: true }, margin: { pct: 20, confirmed: false } };
    const withGlass = design();
    const price = staffPrice(withGlass, cat(costs));
    if (price.status !== 'OK') throw new Error(price.reason);
    const labels = price.lines.map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(['Cooling unit', 'Lighting', 'Installation', 'Margin']));
    const margin = price.lines.find((l) => l.kind === 'margin')!;
    const before = price.lines.filter((l) => l.kind !== 'margin').reduce((n, l) => n + l.amount, 0);
    expect(margin.amount).toBeCloseTo(before * 0.2, 1);
    expect(price.total).toBeCloseTo(before * 1.2, 1);
    expect(price.lines.find((l) => l.label === 'Cooling unit')!.detail).toMatch(/placeholder/);
    expect(price.lines.find((l) => l.label === 'Lighting')!.detail).not.toMatch(/placeholder/);
    expect(price.placeholders).toEqual(expect.arrayContaining(['Cooling unit', 'Margin']));
    expect(price.placeholders).not.toContain('Lighting');
    expect(price.warnings.join(' ')).toMatch(/placeholder/);
    // the customer range grows with the margin
    const plain = staffPrice(withGlass, cat({ ...costs, margin: { pct: 0, confirmed: true } }));
    if (plain.status !== 'OK') throw new Error('no price');
    expect(price.high).toBeGreaterThan(plain.high);
  });

  it('leaves a blank amount out (never as zero), says so, and treats a confirmed zero as no charge', () => {
    const costs = confirmed({ ...NO_COSTS, cooling: { amount: null, confirmed: true }, lighting: { amount: 800, confirmed: true } });
    const price = staffPrice(design(), cat(costs));
    if (price.status !== 'OK') throw new Error('no price');
    expect(price.lines.some((l) => l.label === 'Cooling unit')).toBe(false);
    expect(price.missingCosts).toContain('Cooling unit');
    expect(price.warnings.join(' ')).toMatch(/Cooling unit has no amount/);
    expect(price.lines.some((l) => l.label === 'Installation')).toBe(false); // a confirmed zero: no line, no warning
    expect(price.missingCosts).not.toContain('Installation');
    expect(price.lines.some((l) => l.label === 'Lighting')).toBe(true);
  });

  it('keeps a quote from going out on a placeholder or a missing cost, and lets it through once all are confirmed', () => {
    const p = design();
    const placeholder = quoteBlockers(p, cat(DEFAULT_CONFIG.costs));
    expect(placeholder.join(' ')).toMatch(/Cooling unit is still a placeholder/);
    expect(placeholder.join(' ')).toMatch(/Margin is still a placeholder/);
    const missing = quoteBlockers(p, cat(confirmed({ ...DEFAULT_CONFIG.costs, installation: { amount: null, confirmed: true } })));
    expect(missing.join(' ')).toMatch(/Installation has no amount/);
    const ok = quoteBlockers(p, cat(confirmed(DEFAULT_CONFIG.costs)));
    expect(ok.filter((b) => /placeholder|has no amount/.test(b))).toEqual([]);
  });

  it('the browser reads them defensively: junk becomes the placeholder or "not set", and confirmed only ever comes from an explicit true', () => {
    const c = normaliseConfig({ costs: { cooling: { amount: 'abc', confirmed: 'yes' }, lighting: { amount: -5 }, margin: { pct: 500, confirmed: 1 } } }).costs;
    expect(c.cooling.confirmed).toBe(false);
    expect(c.cooling.amount).toBeNull();
    expect(c.lighting.amount).toBeNull();
    expect(c.margin.pct).toBe(DEFAULT_CONFIG.costs.margin.pct);
    expect(c.margin.confirmed).toBe(false);
    expect(normaliseConfig({ costs: { margin: { pct: null, confirmed: true } } }).costs.margin).toEqual({ pct: null, confirmed: true });
  });
});

describe('what the customer sees on a quote', () => {
  it('never shows the margin as a line: it is folded into the others, which still add up to the total', async () => {
    const { customerLines } = await import('../src/export/quote');
    const costs = confirmed(DEFAULT_CONFIG.costs);
    const price = staffPrice(design(), cat(costs));
    if (price.status !== 'OK') throw new Error('no price');
    expect(price.lines.some((l) => l.kind === 'margin')).toBe(true);
    const shown = customerLines(price.lines, price.total);
    expect(shown.some((l) => /margin/i.test(l.label))).toBe(false);
    expect(Math.round(shown.reduce((n, l) => n + l.amount, 0) * 100) / 100).toBeCloseTo(price.total, 2);
    expect(shown.every((l) => l.detail === '')).toBe(true);
    // with no margin the lines are the staff lines, untouched
    const none = staffPrice(design(), cat({ ...costs, margin: { pct: 0, confirmed: true } }));
    if (none.status !== 'OK') throw new Error('no price');
    expect(customerLines(none.lines, none.total)).toEqual(none.lines);
  });
});
