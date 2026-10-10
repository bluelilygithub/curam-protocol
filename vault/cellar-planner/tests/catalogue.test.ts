import { describe, expect, it } from 'vitest';
import { applyRackType, CATALOGUE_SAVED_KEY, CATALOGUE_URL, createCatalogueStore, defaultType, matchesType, parseCatalogue, rackSpecFromType, staffPrice, type Catalogue } from '../src/app/catalogue';
import { analyseApp, deserializeApp, ESTIMATE_FIELDS, sampleProject, serializeApp, testCaseProject } from '../src/app/model';
import { statusLine } from '../src/export/drawingPackage';
import { DEFAULT_CONFIG, type RackType } from '../src/lite/config';

const T: RackType = { ...DEFAULT_CONFIG.rackTypes[0]!, id: 'std', name: 'Standard 600', unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true };
const W: RackType = { ...T, id: 'wide', name: 'Wide display', unitWidthMm: 900, orientation: 'LABEL_FORWARD', bottlesPerRowLabelForward: 6, pricePerUnit: 1500, confirmed: false, unitDepthMm: null };
const cat = (over: Partial<Catalogue['pricing']> = {}, types: RackType[] = [T, W]): Catalogue => ({
  rackTypes: types, defaultRackType: types[0]!.id, doors: { singleMm: 970, doubleMm: 1500 },
  pricing: { ...DEFAULT_CONFIG.pricing, fixed: 2000, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100, ...over },
});
const unitsOf = (p: ReturnType<typeof testCaseProject>): number => p.runs.reduce((n, r) => n + r.units, 0);

describe('reading the catalogue Vault sends', () => {
  it('accepts the staff payload (with or without the wrapper) and cleans it', () => {
    const body = { catalogue: { rackTypes: [T, { ...W, unitWidthMm: 5 }], defaultRackType: 'wide', doors: { singleMm: 970, doubleMm: 1500 }, pricing: { fixed: 100 } } };
    const c = parseCatalogue(body)!;
    expect(c.rackTypes.map((r) => r.id)).toEqual(['std', 'wide']);
    expect(c.rackTypes[1]!.unitWidthMm).toBe(600); // out of range: falls back, never a wild number
    expect(c.defaultRackType).toBe('wide');
    expect(c.pricing.fixed).toBe(100);
    expect(parseCatalogue(body.catalogue)!.rackTypes.length).toBe(2);
  });
  it('rejects anything that is not a catalogue', () => {
    for (const bad of [null, undefined, 'x', 7, [], {}, { catalogue: {} }, { rackTypes: [] }, { rackTypes: 'x' }]) expect(parseCatalogue(bad), JSON.stringify(bad)).toBeNull();
  });
  it('an unknown default falls back to the first type', () => {
    expect(defaultType(parseCatalogue({ rackTypes: [T, W], defaultRackType: 'nope' }))!.id).toBe('std');
  });
});

describe('choosing a rack type for a design', () => {
  it('a confirmed type puts its numbers in and marks nothing estimated', () => {
    const p = applyRackType(sampleProject(), T);
    expect(p.rackSpec).toEqual(rackSpecFromType(T));
    expect(p.estimated).toEqual([]);
    expect(p.rackType).toEqual({ id: 'std', name: 'Standard 600', confirmed: true });
  });
  it('an unconfirmed type marks every value it has as estimated, and leaves blanks blank', () => {
    const p = applyRackType(sampleProject(), W);
    expect(p.rackSpec.unitDepthMm).toBeNull();
    expect(p.estimated).not.toContain('unitDepthMm');
    expect(p.estimated).toEqual(expect.arrayContaining(['unitWidthMm', 'unitHeightMm', 'orientation']));
    expect(p.rackType!.confirmed).toBe(false);
    for (const k of p.estimated!) expect(ESTIMATE_FIELDS).toContain(k);
  });
  it('the enclosure and the runs are untouched', () => {
    const base = testCaseProject();
    const p = applyRackType(base, T);
    expect(p.enclosure).toBe(base.enclosure);
    expect(p.runs).toBe(base.runs);
  });
  it('switching type replaces the old type\'s estimated marks', () => {
    const p = applyRackType(applyRackType(sampleProject(), W), T);
    expect(p.estimated).toEqual([]);
    expect(p.rackType!.id).toBe('std');
  });
  it('knows when the values still match the catalogue and when they were edited', () => {
    const p = applyRackType(sampleProject(), T);
    expect(matchesType(p, T)).toBe(true);
    expect(matchesType({ ...p, rackSpec: { ...p.rackSpec, unitWidthMm: 650 } }, T)).toBe(false);
    expect(matchesType(p, W)).toBe(false);
  });
  it('is kept in a saved design and read back; a damaged one is dropped', () => {
    const p = applyRackType(testCaseProject(), W);
    expect(deserializeApp(serializeApp(p)).rackType).toEqual({ id: 'wide', name: 'Wide display', confirmed: false });
    const raw = JSON.parse(serializeApp(p));
    for (const bad of [null, 'x', 5, {}, { id: '' }, { id: 7 }]) expect(deserializeApp(JSON.stringify({ ...raw, rackType: bad })).rackType, JSON.stringify(bad)).toBeUndefined();
    expect(deserializeApp(JSON.stringify({ ...raw, rackType: { id: 'a', confirmed: 'yes' } })).rackType).toEqual({ id: 'a', name: 'a', confirmed: false });
  });
  it('older designs without a rack type still open', () => {
    const raw = JSON.parse(serializeApp(testCaseProject()));
    delete raw.rackType;
    expect(deserializeApp(JSON.stringify(raw)).rackType).toBeUndefined();
  });
});

describe('the staff price breakdown', () => {
  const chosen = applyRackType(testCaseProject(), T);
  it('adds the fixed amount, units x price per unit and the door, then a rounded range', () => {
    const r = staffPrice(chosen, cat());
    if (r.status !== 'OK') throw new Error(r.reason);
    const units = unitsOf(chosen);
    expect(r.lines.map((l) => l.label)).toEqual(['Fixed amount', 'Standard 600 racks', 'Single door']);
    expect(r.lines[1]!.amount).toBe(units * 900);
    expect(r.lines[1]!.detail).toBe(`${units} units x $900`);
    expect(r.total).toBe(2000 + units * 900 + 500);
    const mid = r.total;
    expect(r.low).toBe(Math.round((mid * 0.9) / 100) * 100);
    expect(r.high).toBe(Math.round((mid * 1.1) / 100) * 100);
    expect(r.text).toBe(`$${r.low.toLocaleString('en-AU')} to $${r.high.toLocaleString('en-AU')}`);
    expect(r.warnings).toEqual([]); // confirmed type, no errors
  });
  it('uses the double door price for a double door', () => {
    const dbl = { ...chosen, enclosure: { ...chosen.enclosure, door: { ...chosen.enclosure.door, leaves: 2 as const } } };
    const r = staffPrice(dbl, cat());
    if (r.status !== 'OK') throw new Error(r.reason);
    expect(r.lines.at(-1)).toMatchObject({ label: 'Double door', amount: 900 });
  });
  it('ignores the public "show prices" switch: staff always see the price', () => {
    expect(staffPrice(chosen, cat({ show: false })).status).toBe('OK');
  });
  it('leaves out an amount that is not set instead of counting it as zero, and says so', () => {
    const free = { ...T, pricePerUnit: null };
    const r = staffPrice(applyRackType(testCaseProject(), free), cat({}, [free, W]));
    if (r.status !== 'OK') throw new Error(r.reason);
    expect(r.lines.map((l) => l.label)).toEqual(['Fixed amount', 'Single door']);
    expect(r.warnings.join(' ')).toMatch(/no price per unit/);
  });
  it('warns when the type is not confirmed and when the design has errors', () => {
    const r = staffPrice(applyRackType(testCaseProject(), W), cat(), { errors: 2 });
    if (r.status !== 'OK') throw new Error(r.reason);
    expect(r.warnings.join(' | ')).toMatch(/not confirmed by the supplier/);
    expect(r.warnings.join(' | ')).toMatch(/2 checks in this design show an error/);
    expect(staffPrice(chosen, cat(), { errors: 1 })).toMatchObject({ warnings: ['1 check in this design shows an error: fix it before relying on this price.'] });
  });
  it('never invents a price: says why there is none', () => {
    const why = (r: ReturnType<typeof staffPrice>): string => (r.status === 'UNAVAILABLE' ? r.reason : 'PRICED');
    expect(why(staffPrice(chosen, null))).toMatch(/could not be loaded/);
    expect(why(staffPrice(testCaseProject(), cat()))).toMatch(/Choose a rack type/);
    expect(why(staffPrice({ ...chosen, rackType: { id: 'gone', name: 'Old rack', confirmed: true } }, cat()))).toMatch(/"Old rack" is no longer in the catalogue/);
    expect(why(staffPrice({ ...chosen, runs: [] }, cat()))).toMatch(/Place some racks/);
    expect(why(staffPrice(applyRackType(testCaseProject(), { ...T, pricePerUnit: null }), cat({ fixed: null, doorSingle: null, doorDouble: null }, [{ ...T, pricePerUnit: null }])))).toMatch(/No prices have been entered/);
  });
  it('a single rack unit reads "1 unit"', () => {
    const one = { ...chosen, runs: [{ ...chosen.runs[0]!, units: 1 }] };
    const r = staffPrice(one, cat());
    if (r.status !== 'OK') throw new Error(r.reason);
    expect(r.lines[1]!.detail).toBe('1 unit x $900');
  });
});

describe('loading the catalogue never breaks the planner', () => {
  const body = { catalogue: { rackTypes: [T, W], defaultRackType: 'std', doors: { singleMm: 970, doubleMm: 1500 }, pricing: { fixed: 2000 } } };
  const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
  const signedIn = JSON.stringify({ state: { token: 'tok123' } });
  const ok = (b: unknown, status = 200) => async () => ({ ok: status < 400, status, json: async () => b }) as Response;

  it('loads with the Vault token, remembers the answer and reports where it came from', async () => {
    const storage = mem({ 'vault-auth': signedIn });
    const seen: Array<[string, RequestInit | undefined]> = [];
    const store = createCatalogueStore();
    await store.getState().load(async (u, i) => { seen.push([u, i]); return ok(body)(); }, storage);
    expect(seen[0]![0]).toBe(CATALOGUE_URL);
    expect((seen[0]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
    expect(store.getState().status).toBe('server');
    expect(store.getState().catalogue!.rackTypes.length).toBe(2);
    expect(storage.m.has(CATALOGUE_SAVED_KEY)).toBe(true);
  });
  it('without a token it does not even ask, and says so', async () => {
    const store = createCatalogueStore(); let asked = false;
    await store.getState().load(async () => { asked = true; return ok(body)(); }, mem());
    expect(asked).toBe(false);
    expect(store.getState()).toMatchObject({ status: 'unavailable', catalogue: null });
    expect(store.getState().reason).toMatch(/not signed in/);
  });
  it('uses the remembered catalogue when Vault cannot be reached, with the reason', async () => {
    const storage = mem({ 'vault-auth': signedIn, [CATALOGUE_SAVED_KEY]: JSON.stringify(body) });
    const store = createCatalogueStore();
    await store.getState().load(async () => { throw new TypeError('Failed to fetch'); }, storage);
    expect(store.getState().status).toBe('saved');
    expect(store.getState().reason).toMatch(/Failed to fetch/);
    expect(store.getState().catalogue!.rackTypes.length).toBe(2);
  });
  it('no remembered copy and no answer: unavailable, never a crash', async () => {
    const store = createCatalogueStore();
    await store.getState().load(async () => { throw new Error('boom'); }, mem({ 'vault-auth': signedIn }));
    expect(store.getState()).toMatchObject({ status: 'unavailable', catalogue: null, reason: 'boom' });
  });
  it('explains a 403 (feature off), other statuses, and a body that is not a catalogue', async () => {
    const run = async (f: () => Promise<Response>, saved = false) => { const s = createCatalogueStore(); await s.getState().load(f, mem({ 'vault-auth': signedIn, ...(saved ? { [CATALOGUE_SAVED_KEY]: 'not json' } : {}) })); return s.getState(); };
    expect((await run(ok({}, 403))).reason).toMatch(/does not have the Cellar Planner feature/);
    expect((await run(ok({}, 500))).reason).toMatch(/answered 500/);
    expect((await run(ok({ nope: 1 }))).reason).toMatch(/not a rack catalogue/);
    expect((await run(ok({}, 500), true)).status).toBe('unavailable'); // a damaged remembered copy is ignored
  });
  it('a browser with no fetch is handled', async () => {
    const store = createCatalogueStore();
    await store.getState().load(undefined, mem({ 'vault-auth': signedIn }));
    expect(store.getState().status).toBe('unavailable');
  });
});

describe('what the drawing package says about the rack values', () => {
  it('a confirmed catalogue type is not called a guess', () => {
    const p = applyRackType(testCaseProject(), T);
    expect(statusLine(p, analyseApp(p))).not.toMatch(/GUESS|NOT YET CONFIRMED/);
  });
  it('an unconfirmed catalogue type says it is not yet confirmed by the supplier, naming the type', () => {
    const p = applyRackType(testCaseProject(), W);
    expect(statusLine(p, analyseApp(p))).toMatch(/RACK VALUES \(Wide display\) NOT YET CONFIRMED BY THE SUPPLIER.*NOT FOR QUOTING OR FABRICATION/);
  });
  it('the old best-guess wording is unchanged for a test case', () => {
    const p = testCaseProject();
    expect(statusLine(p, analyseApp(p))).toMatch(/RACK VALUES ARE BEST GUESSES/);
  });
});
