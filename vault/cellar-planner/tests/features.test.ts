import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { applyRackType, designFeatures, staffPrice, type Catalogue } from '../src/app/catalogue';
import { deserializeApp, serializeApp, testCaseProject, type AppProject } from '../src/app/model';
import { buildQuote, layoutQuote, quoteBlockers } from '../src/export/quote';
import type { Fonts } from '../src/export/drawingPackage';
import { DEFAULT_CONFIG, normaliseConfig, normaliseFeatures, type FeatureGroup, type LiteConfig, type RackType } from '../src/lite/config';
import { buildScene } from '../src/lite/cellarScene';
import { analyseApp, fullRuns } from '../src/app/model';
import { cleanPicks, effectsOf, featureTotals, optionMid, priceLabel, resolveFeatures, togglePick, unavailableReason } from '../src/lite/features';
import { priceRange } from '../src/lite/price';
import { decodeDesign, defaultLite, encodeDesign, liteToProject, summaryLine, type LiteSettings } from '../src/lite/settings';

const require = createRequire(import.meta.url);
const server = require('../../server/config/cellarLiteConfig.js') as { DEFAULTS: { features: unknown }; validateConfig: (raw: unknown) => { config: LiteConfig; errors: string[] } };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** The standard list with the prices the design mockup showed, so totals can be checked by hand. */
const priced = (): FeatureGroup[] => {
  const f = clone(DEFAULT_CONFIG.features);
  const set = (id: string, low: number, high: number): void => { for (const g of f) for (const o of g.options) if (o.id === id) { o.low = low; o.high = high; } };
  set('glass-doors', 2800, 3600); set('full-glass-front', 7500, 9800); set('in-rack-led', 1600, 2200); set('ducted-split', 2400, 3200);
  set('magnum-large-format', 900, 1300); set('island-with-drawers', 6500, 8500); set('stone-tile', 1500, 2200);
  return f;
};
const code = (id: string): number => { for (const g of DEFAULT_CONFIG.features) for (const o of g.options) if (o.id === id) return o.code; throw new Error(id); };
const ROOM = { widthMm: 2750, depthMm: 1565 };
const cfgWith = (features: FeatureGroup[], pricing: Partial<LiteConfig['pricing']> = {}): LiteConfig => ({ ...DEFAULT_CONFIG, features, pricing: { ...DEFAULT_CONFIG.pricing, show: true, fixed: 2000, perUnit: 1000, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100, ...pricing } });

describe('the standard feature list', () => {
  it('has the seven groups and twenty-one options from the design, with unique stable codes and a standard option in every pick-one group', () => {
    const f = DEFAULT_CONFIG.features;
    expect(f.map((g) => g.name)).toEqual(['Front & doors', 'Lighting', 'Special storage', 'Centrepiece', 'Climate system', 'Wall finish', 'Flooring']);
    const all = f.flatMap((g) => g.options);
    expect(all.length).toBe(21);
    expect(new Set(all.map((o) => o.code)).size).toBe(21);
    for (const g of f) expect(g.options.filter((o) => o.included).length, g.name).toBe(g.mode === 'ONE' ? 1 : 0);
    expect(f.find((g) => g.id === 'special-storage')!.mode).toBe('ANY');
    expect(all.every((o) => o.low === null && o.high === null)).toBe(true); // prices start blank: nothing is invented
  });
  it('the browser and the server clean a list the same way, including codes given to new options', () => {
    const messy = clone(priced());
    messy[1]!.options.push({ ...messy[1]!.options[0]!, code: 0, id: '', name: 'Fibre-optic stars', included: false, low: 5000, high: 4000 } as never);
    messy[0]!.options[1]!.code = messy[0]!.options[2]!.code; // a duplicate code
    messy[2]!.options[0]!.included = true; // a pick-any group has no standard
    messy[0]!.options.forEach((o) => { o.included = false; }); // a pick-one group needs one
    const a = normaliseFeatures(messy);
    const b = server.validateConfig({ features: messy }).config.features;
    expect(a).toEqual(b);
    expect(a.flatMap((g) => g.options).every((o) => o.code >= 1 && o.code <= 999)).toBe(true);
    expect(new Set(a.flatMap((g) => g.options.map((o) => o.code))).size).toBe(a.flatMap((g) => g.options).length);
    expect(a[0]!.options.filter((o) => o.included).length).toBe(1);
    expect(a[2]!.options.some((o) => o.included)).toBe(false);
    expect(a[1]!.options.at(-1)!.high).toBe(5000); // low above high: high is raised to low, never an upside-down range
  });
  it('a missing list is the standard one; a list that is present (even empty) is the owner\'s', () => {
    expect(normaliseFeatures(undefined)).toEqual(DEFAULT_CONFIG.features);
    expect(normaliseFeatures([])).toEqual([]);
    expect(normaliseConfig({}).features).toEqual(DEFAULT_CONFIG.features);
    expect(normaliseConfig({ features: [] }).features).toEqual([]);
    expect(server.validateConfig({ features: [] }).config.features).toEqual([]);
  });
});

describe('resolving what is chosen', () => {
  const f = priced();
  it('shows the standard option of every pick-one group, and no extras, when nothing is picked', () => {
    const r = resolveFeatures(f, [], ROOM);
    expect(r.extras).toEqual([]);
    expect(r.groups.find((g) => g.group.id === 'front')!.chosen.map((o) => o.id)).toEqual(['timber-doors']);
    expect(r.groups.find((g) => g.group.id === 'special-storage')!.chosen).toEqual([]);
  });
  it('a pick replaces the standard in a pick-one group, and several picks stack in a pick-any group', () => {
    const r = resolveFeatures(f, [code('glass-doors'), code('magnum-large-format'), code('champagne-bins')], ROOM);
    expect(r.groups.find((g) => g.group.id === 'front')!.chosen.map((o) => o.id)).toEqual(['glass-doors']);
    expect(r.extras.map((o) => o.id)).toEqual(['glass-doors', 'magnum-large-format', 'champagne-bins']);
  });
  it('ignores a pick that does not fit the room, that is switched off, or that is no longer in the list', () => {
    const island = code('island-with-drawers');
    expect(resolveFeatures(f, [island], { widthMm: 4000, depthMm: 1565 }).extras).toEqual([]);
    expect(resolveFeatures(f, [island], { widthMm: 4000, depthMm: 2400 }).extras.map((o) => o.id)).toEqual(['island-with-drawers']);
    expect(unavailableReason(f.flatMap((g) => g.options).find((o) => o.id === 'island-with-drawers')!, ROOM)).toBe('Needs a room at least 2.4 m deep.');
    const off = clone(f); off[0]!.options[1]!.enabled = false;
    expect(resolveFeatures(off, [code('glass-doors')], ROOM).extras).toEqual([]);
    expect(resolveFeatures(f, [777], ROOM).extras).toEqual([]);
  });
  it('togglePick keeps one pick per pick-one group (choosing the standard clears it) and toggles pick-any options', () => {
    const front = f[0]!, storage = f[2]!;
    let picks: number[] = [];
    picks = togglePick(f, picks, front, front.options[1]!); expect(picks).toEqual([2]);
    picks = togglePick(f, picks, front, front.options[2]!); expect(picks).toEqual([3]);
    picks = togglePick(f, picks, front, front.options[0]!); expect(picks).toEqual([]);
    picks = togglePick(f, picks, storage, storage.options[0]!); picks = togglePick(f, picks, storage, storage.options[1]!);
    expect(picks).toEqual([7, 8]);
    picks = togglePick(f, picks, storage, storage.options[0]!); expect(picks).toEqual([8]);
  });
  it('cleanPicks keeps whole codes 1 to 999 once each, in order', () => {
    expect(cleanPicks([5, 2, 5, 0, 1000, 1.5, 'x', 999])).toEqual([2, 5, 999]);
    expect(cleanPicks('nope')).toEqual([]);
  });
  it('only glass, wall and floor picks change the picture', () => {
    const r = resolveFeatures(f, [code('glass-doors'), code('in-rack-led'), code('stone-tile')], ROOM);
    expect(effectsOf(r.extras).sort()).toEqual(['FLOOR_STONE', 'GLASS_DOORS']);
  });
});

describe('feature prices', () => {
  const f = priced();
  it('adds each option\'s low and high, counts one-sided prices at both ends, and names options with no price', () => {
    const r = resolveFeatures(f, [code('glass-doors'), code('ducted-split'), code('case-storage')], ROOM);
    const t = featureTotals(r.extras);
    expect(t.low).toBe(2800 + 2400); expect(t.high).toBe(3600 + 3200); expect(t.mid).toBe(3200 + 2800);
    expect(t.unpriced.map((o) => o.id)).toEqual(['case-storage']);
    const one = clone(f); const o = one[0]!.options[1]!; o.low = 3000; o.high = null;
    expect(featureTotals([o])).toMatchObject({ low: 3000, high: 3000, mid: 3000 });
    expect(optionMid(DEFAULT_CONFIG.features[0]!.options[1]!)).toBeNull();
  });
  it('the guide price adds each feature\'s low to the bottom and high to the top, outside the +/- percentage', () => {
    const cfg = cfgWith(f);
    const base = priceRange(cfg, 10, 'SINGLE', 0)!; // 2000 + 10000 + 500 = 12500, +/- 10%
    expect([base.low, base.high]).toEqual([11300, 13800]);
    const extras = resolveFeatures(f, [code('glass-doors'), code('ducted-split')], ROOM).extras;
    const withF = priceRange(cfg, 10, 'SINGLE', 0, extras)!;
    expect([withF.low, withF.high]).toEqual([11300 + 5200, 13800 + 6800]);
    expect(withF.text).toBe('$16,500 to $20,600');
  });
  it('with no base amounts, or prices hidden, or a problem, no price is shown even if features are priced', () => {
    const extras = resolveFeatures(f, [code('glass-doors')], ROOM).extras;
    expect(priceRange(cfgWith(f, { fixed: null, perUnit: null, doorSingle: null }), 10, 'SINGLE', 0, extras)).toBeNull();
    expect(priceRange(cfgWith(f, { show: false }), 10, 'SINGLE', 0, extras)).toBeNull();
    expect(priceRange(cfgWith(f), 10, 'SINGLE', 1, extras)).toBeNull();
  });
  it('labels each card: Included, a range, one figure, price on request, or nothing while prices are hidden', () => {
    const o = (id: string) => f.flatMap((g) => g.options).find((x) => x.id === id)!;
    expect(priceLabel(o('timber-doors'), '$', true)).toBe('Included');
    expect(priceLabel(o('glass-doors'), '$', true)).toBe('+$2,800–3,600');
    expect(priceLabel(o('case-storage'), '$', true)).toBe('Price on request');
    expect(priceLabel(o('glass-doors'), '$', false)).toBe('');
    expect(priceLabel(o('timber-doors'), '$', false)).toBe('Included');
    expect(priceLabel({ ...o('glass-doors'), low: 500, high: 500 }, '$', true)).toBe('+$500');
  });
});

describe('the design code and the enquiry line', () => {
  it('a design with no features has exactly the code it always had', () => {
    expect(encodeDesign(defaultLite())).toBe('CL1.' + btoaUrl([2750, 1565, 2150, 2, 0, 0, 500, 0]));
  });
  it('round-trips the picks, sorted, and clamps nonsense', () => {
    const s: LiteSettings = { ...defaultLite(), finish: 'WALNUT', features: [8, 2, 8, 20] };
    expect(decodeDesign(encodeDesign(s))!.features).toEqual([2, 8, 20]);
    expect(decodeDesign(encodeDesign(s))!.finish).toBe('WALNUT');
    expect(encodeDesign({ ...defaultLite(), features: [3] })).toMatch(/^CL1\.[A-Za-z0-9_-]+$/);
    expect(encodeDesign({ ...defaultLite(), features: Array.from({ length: 21 }, (_, i) => i + 1) }).length).toBeLessThan(200); // the page script accepts up to 200 characters
  });
  it('the enquiry line names the extras that count for the room, not the standard options or the ones that do not fit', () => {
    const cfg = cfgWith(priced());
    const s: LiteSettings = { ...defaultLite(), features: [code('glass-doors'), code('ducted-split'), code('island-with-drawers')] }; // the island needs 2.4 m depth
    expect(summaryLine(s, 480, cfg)).toContain(', features: Frameless glass doors, Ducted split system, about 480 bottles');
    expect(summaryLine(defaultLite(), 480, cfg)).not.toContain('features');
  });
  it('the project made from a design carries the picks (for the staff planner to read against the current list)', () => {
    expect(liteToProject({ ...defaultLite(), features: [2, 15] }, DEFAULT_CONFIG).features).toEqual([2, 15]);
    expect(liteToProject(defaultLite(), DEFAULT_CONFIG).features).toBeUndefined();
  });
});

function btoaUrl(a: number[]): string { return btoa(JSON.stringify(a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

describe('the staff price, the quote and the saved design', () => {
  const T: RackType = { ...DEFAULT_CONFIG.rackTypes[0]!, id: 'std', name: 'Standard 600', unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true };
  const QUOTE = { businessName: 'Acme Wine Cellars', details: '', terms: '', validityDays: 30, gstNote: '' };
  const cat = (features = priced()): Catalogue => ({ rackTypes: [T], defaultRackType: 'std', doors: { singleMm: 970, doubleMm: 1500 }, pricing: { ...DEFAULT_CONFIG.pricing, fixed: 2000, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100 }, quote: QUOTE, cooling: { ...DEFAULT_CONFIG.cooling }, features });
  const base = (): AppProject => applyRackType(testCaseProject(), T);
  const META = { reference: 'Q1', date: '2026-10-12', customer: 'Sam', address: '', notes: '' };

  it('adds a line for each chosen extra at the midpoint, and the customer range adds the lows and highs', () => {
    const plain = staffPrice(base(), cat());
    const p: AppProject = { ...base(), features: [code('glass-doors'), code('ducted-split')] };
    const r = staffPrice(p, cat());
    if (plain.status !== 'OK' || r.status !== 'OK') throw new Error('no price');
    expect(r.lines.filter((l) => l.kind === 'feature').map((l) => [l.label, l.amount])).toEqual([['Front & doors: Frameless glass doors', 3200], ['Climate system: Ducted split system', 2800]]);
    expect(r.total).toBe(plain.total + 6000);
    expect(r.low).toBe(plain.low + 5200); expect(r.high).toBe(plain.high + 6800);
    expect(r.unpriced).toEqual([]);
  });
  it('a typed amount for this design replaces the midpoint, and a standard option adds nothing', () => {
    const plain = staffPrice(base(), cat());
    const p: AppProject = { ...base(), features: [code('glass-doors')], featurePrices: { [code('glass-doors')]: 3333 } };
    const r = staffPrice(p, cat());
    if (plain.status !== 'OK' || r.status !== 'OK') throw new Error('no price');
    expect(r.total).toBe(plain.total + 3333);
    expect(r.lines.find((l) => l.kind === 'feature')!.detail).toBe('amount set for this quote');
    expect(r.high).toBe(plain.high + 3600); // the customer range still follows the catalogue, not the typed figure
  });
  it('a chosen option with no price is named, left out of the total, and stops the quote', () => {
    const p: AppProject = { ...base(), features: [code('case-storage')] };
    const r = staffPrice(p, cat());
    if (r.status !== 'OK') throw new Error('no price');
    expect(r.unpriced).toEqual(['Special storage: Case storage']);
    expect(r.warnings.join(' ')).toContain('Special storage: Case storage has no price');
    expect(quoteBlockers(p, cat()).join(' ')).toContain('"Special storage: Case storage" is chosen but has no price');
    expect(quoteBlockers(base(), cat())).toEqual([]); // and the same design without it is fine
  });
  it('a pick that does not fit this room or is no longer in the list is ignored', () => {
    const p: AppProject = { ...base(), features: [code('island-with-drawers'), 555] }; // the sample room is too shallow for the island
    expect(designFeatures(p, cat())!.extras).toEqual([]);
    const plain = staffPrice(base(), cat()), r = staffPrice(p, cat());
    if (plain.status !== 'OK' || r.status !== 'OK') throw new Error('no price');
    expect(r.total).toBe(plain.total);
  });
  it('the quote lists the features in the price table and in the cellar details', async () => {
    const p: AppProject = { ...base(), features: [code('glass-doors')] };
    const q = buildQuote(p, cat(), META);
    if (!q.ok) throw new Error(q.blockers.join('|'));
    expect(q.doc.lines.some((l) => l.label === 'Front & doors: Frameless glass doors' && l.amount === 3200)).toBe(true);
    expect(q.doc.cellar.find(([k]) => k === 'Features')![1]).toBe('Frameless glass doors');
    const d = await PDFDocument.create();
    const fonts: Fonts = { regular: await d.embedFont(StandardFonts.Helvetica), bold: await d.embedFont(StandardFonts.HelveticaBold), italic: await d.embedFont(StandardFonts.HelveticaOblique) };
    expect(layoutQuote(q.doc, fonts).length).toBeGreaterThan(0);
    expect(q.doc.total).toBe(q.doc.lines.reduce((n, l) => n + l.amount, 0));
  });
  it('picks and typed amounts survive a save and reopen, and bad values in a file are dropped', () => {
    const p: AppProject = { ...base(), features: [2, 15], featurePrices: { 2: 3333.456 } };
    const back = deserializeApp(serializeApp(p));
    expect(back.features).toEqual([2, 15]); expect(back.featurePrices).toEqual({ 2: 3333.46 });
    const dirty = deserializeApp(serializeApp({ ...base(), features: [3, 3, 0, 5000, 'x'] as never, featurePrices: { 3: -1, 9: 'a', 0: 5, 4: 99 } as never }));
    expect(dirty.features).toEqual([3]); expect(dirty.featurePrices).toEqual({ 4: 99 });
    expect(deserializeApp(serializeApp(base())).features).toBeUndefined();
  });
});

describe('the 3D picture', () => {
  it('carries the picture effects through and draws the same racks and bottles with or without them', () => {
    const p = liteToProject(defaultLite(), DEFAULT_CONFIG);
    const a = analyseApp(p);
    const input = { project: p, runs: fullRuns(p), analysis: a.racks };
    const plain = buildScene(input), fancy = buildScene({ ...input, effects: ['GLASS_DOORS', 'WALL_STONE', 'FLOOR_OAK'] });
    expect(plain.effects).toEqual([]); expect(fancy.effects).toEqual(['GLASS_DOORS', 'WALL_STONE', 'FLOOR_OAK']);
    expect(fancy.stats).toEqual(plain.stats); // a feature never changes a bottle count
  });
});
