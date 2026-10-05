#!/usr/bin/env node
/**
 * Document scanner tests — fixtures stand in for the TEXT a real PDF/photo would yield
 * (text PDF lines, OCR output with confidences, AU/US recipes, a plan spec sheet).
 * Real-file checks (text PDF, scanned PDF, phone photo) are manual — see docs/measurement-converter.md.
 * Run: node client/src/utils/units/scanner.test.mjs
 */
import assert from 'assert';
import { scanText, scanDocument, proposeFor, buildConvertedText, DEFAULT_PREFS } from './scanner.mjs';

let n = 0;
function test(name, fn) {
  try { fn(); n += 1; console.log(`PASS  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}
const RANK = (c) => ({ high: 3, medium: 2, low: 1 }[c]);
const scan = (t, o) => scanText(t, { region: 'imperial', context: 'general', ...o });
const one = (t, o) => { const h = scan(t, o); assert.strictEqual(h.length, 1, `expected 1 hit in "${t}", got ${h.length}: ${h.map((x) => x.raw).join(' | ')}`); return h[0]; };
const flagCodes = (h) => h.flags.map((f) => f.code);
const docOf = (lines, o, ocr = false) => scanDocument([{ lines: lines.map((text) => ({ text })), ocr }], o);

// ── number formats ──
test('plain, spaced and attached units', () => {
  assert.deepStrictEqual(one('Use 25 mm screws').values, [25]);
  assert.deepStrictEqual(one('Use 25mm screws').values, [25]);
});
test('fractions, mixed numbers and unicode fractions', () => {
  assert.deepStrictEqual(one('add 3/4 cup').values, [0.75]);
  assert.deepStrictEqual(one('add 2 1/4 cups').values, [2.25]);
  assert.deepStrictEqual(one('add 1½ cups').values, [1.5]);
  assert.deepStrictEqual(one('add 1 ½ cups').values, [1.5]);
  assert.deepStrictEqual(one('add ½ cup').values, [0.5]);
});
test('ranges', () => {
  const a = one('Roast at 180 to 200 °C'); assert.strictEqual(a.kind, 'range'); assert.deepStrictEqual(a.values, [180, 200]); assert.strictEqual(a.unitIds[0], 'temperature.celsius');
  const b = one('Length 2–3 m', { context: 'building' }); assert.strictEqual(b.kind, 'range'); assert.deepStrictEqual(b.values, [2, 3]);
});
test('dimensions: 1200 × 600 × 18 mm and 4\' x 8\'', () => {
  const a = one('Sheet 1200 × 600 × 18 mm'); assert.strictEqual(a.kind, 'dimension'); assert.deepStrictEqual(a.values, [1200, 600, 18]); assert.ok(a.unitIds.every((u) => u === 'length.millimetre'));
  const b = one("Panel 4' x 8' ply"); assert.strictEqual(b.kind, 'dimension'); assert.deepStrictEqual(b.values, [4, 8]); assert.ok(b.unitIds.every((u) => u === 'length.foot'));
});
test('compounds: 5′ 11″, 10 st 4 lb, 1 h 30 min', () => {
  const a = one('Height 5′ 11″'); assert.strictEqual(a.kind, 'compound'); assert.deepStrictEqual(a.values, [5, 11]); assert.strictEqual(a.unitIds[0], 'length.ftin'); assert.strictEqual(a.confidence, 'high');
  const b = one('Weight 10 st 4 lb'); assert.deepStrictEqual(b.values, [10, 4]); assert.strictEqual(b.unitIds[0], 'mass.stlb');
  const c = one('Runtime 1 h 30 min'); assert.deepStrictEqual(c.values, [1, 30]); assert.strictEqual(c.unitIds[0], 'time.hmin');
});
test('straight-quote feet+inches: 6\' 8" is high confidence (paired)', () => {
  const h = one('Door 6\' 8" high'); assert.strictEqual(h.unitIds[0], 'length.ftin'); assert.strictEqual(h.confidence, 'high');
});
test('DMS angle', () => { const h = one('Bearing 12° 30′ 15″'); assert.strictEqual(h.unitIds[0], 'angle.dms'); assert.deepStrictEqual(h.values, [12, 30, 15]); });
test('thousands separator vs decimal comma', () => {
  assert.deepStrictEqual(one('Width 1,200 mm').values, [1200]);
  const d = one('Width 1,5 m', { context: 'building' }); assert.deepStrictEqual(d.values, [1.5]); assert.ok(flagCodes(d).includes('decimal-comma'));
});
test('gas mark and temperatures', () => {
  assert.strictEqual(one('Bake at gas mark 4').unitIds[0], 'temperature.gasmark');
  assert.strictEqual(one('Bake at 350°F').unitIds[0], 'temperature.fahrenheit');
  assert.strictEqual(one('Bake at 350 ºF').unitIds[0], 'temperature.fahrenheit');
});
test('no unit → no hit; prose numbers ignored', () => assert.strictEqual(scan('Order 12345 arrived on 3 May 2024').length, 0));

// ── ambiguities: flagged, never silent ──
test('bare ° is unresolved and flagged, never guessed', () => {
  const h = one('Turn the dial to 45° for best results');
  assert.ok(flagCodes(h).includes('degree-ambiguous')); assert.strictEqual(h.unitIds[0], null); assert.strictEqual(proposeFor(h).status, 'needs-unit');
});
test('"m" flagged as metres/minutes when unsure', () => {
  assert.ok(flagCodes(one('Walk 5 m')).includes('ambiguous-unit'));
  const r = one('Simmer for 10 m', { context: 'recipe' }); assert.strictEqual(r.unitIds[0], 'time.minute'); assert.ok(flagCodes(r).includes('ambiguous-unit'));
  const b = one('Wall 3.6 m', { context: 'building' }); assert.strictEqual(b.unitIds[0], 'length.metre'); assert.strictEqual(flagCodes(b).length, 0);
});
test('t / T flagged: teaspoon, tablespoon, tonne', () => {
  const r1 = one('Add 1 T oil', { context: 'recipe' }); assert.strictEqual(r1.unitIds[0], 'volume.tbsp'); assert.ok(flagCodes(r1).includes('ambiguous-unit'));
  const r2 = one('Add 1 t salt', { context: 'recipe' }); assert.strictEqual(r2.unitIds[0], 'volume.tsp');
  const b = one('Load 2 t of gravel', { context: 'building' }); assert.strictEqual(b.unitIds[0], 'mass.tonne'); assert.ok(flagCodes(b).includes('ambiguous-unit'));
});
test('oz: weight vs fluid ounces', () => {
  const w = one('Add 8 oz cheese'); assert.strictEqual(w.unitIds[0], 'mass.ounce'); assert.ok(flagCodes(w).includes('ambiguous-unit'));
  const f = one('Add 8 oz milk', { context: 'recipe', region: 'us' }); assert.strictEqual(f.unitIds[0], 'volume.floz_us');
});
test('straight quote alone is flagged as maybe a quote mark', () => {
  const h = one('The board is 8" wide'); assert.strictEqual(h.unitIds[0], 'length.inch'); assert.ok(flagCodes(h).includes('ambiguous-unit'));
});
test('"in" as a word is flagged', () => {
  const h = one('Only 5 in the box'); assert.ok(flagCodes(h).includes('word-in')); assert.strictEqual(h.confidence, 'low');
  assert.ok(flagCodes(one('Rank 1,240 in Clothing, Shoes')).includes('word-in'));
  assert.strictEqual(flagCodes(one('Board 5 in wide')).length, 0);
  assert.strictEqual(flagCodes(one('Width 5 in.')).length, 0);
});
test('regional gallon / cup are flagged with the assumption stated', () => {
  const g = one('Tank 10 gallons', { region: 'us' }); assert.strictEqual(g.unitIds[0], 'volume.gallon_us'); assert.ok(g.flags[0].message.includes('US'));
  const gi = one('Tank 10 gallons', { region: 'imperial' }); assert.strictEqual(gi.unitIds[0], 'volume.gallon_imp');
  const c = one('1 cup milk', { cupStandard: 'us' }); assert.ok(c.flags[0].message.includes('US'));
});
test('axis letters in dimensions: 10.4D x 6.8W x 1.9H centimetres', () => {
  const h = one('Item Dimensions D x W x H 10.4D x 6.8W x 1.9H centimetres');
  assert.strictEqual(h.kind, 'dimension'); assert.deepStrictEqual(h.values, [10.4, 6.8, 1.9]); assert.ok(h.unitIds.every((u) => u === 'length.centimetre'));
  assert.deepStrictEqual(one('Size 5W x 3H x 2D m', { context: 'building' }).values, [5, 3, 2]);
  assert.strictEqual(one('Motor 5 W').unitIds[0], 'power.watt');
});
test('KB / MB flagged (decimal vs binary)', () => assert.ok(flagCodes(one('File is 500 KB')).includes('ambiguous-unit')));
test('°C is not flagged as ambiguous', () => assert.strictEqual(flagCodes(one('Heat to 180 °C')).length, 0));

// ── tables ──
test('unit only in the column header: Width (mm)', () => {
  const t = 'Item        Width (mm)   Height (mm)\nDoor        900          2100\nWindow      1200         2400\n\nNotes follow.';
  const hits = scan(t);
  assert.strictEqual(hits.length, 4);
  assert.ok(hits.every((h) => h.fromHeader && h.unitIds[0] === 'length.millimetre' && flagCodes(h).includes('column-header')));
  assert.deepStrictEqual(hits.map((h) => h.values[0]), [900, 2100, 1200, 2400]);
});

// ── fixtures ──
test('fixture: text PDF', () => {
  const hits = docOf(['Specification sheet', 'Panel size 2400 × 1200 × 12 mm, weight 22 kg.', 'Operating range -10 to 40 °C.', 'Working pressure 200 kPa (29 psi).', 'Clearance 1,200 mm minimum.'], { context: 'general' });
  assert.deepStrictEqual(hits.map((h) => h.raw), ['2400 × 1200 × 12 mm', '22 kg', '-10 to 40 °C', '200 kPa', '29 psi', '1,200 mm']);
});
test('fixture: AU recipe', () => {
  const au = ['Ingredients', '2 cups self-raising flour', '1/2 cup caster sugar', '1 tbsp butter', '1 t vanilla', 'Bake at 180°C (gas mark 4) for 25 min'];
  const hits = docOf(au, { context: 'recipe', cupStandard: 'au' });
  assert.deepStrictEqual(hits.map((h) => h.raw), ['2 cups', '1/2 cup', '1 tbsp', '1 t', '180°C', 'gas mark 4', '25 min']);
  assert.strictEqual(proposeFor(hits[2], { ...DEFAULT_PREFS, cupStandard: 'au' }).text, '20 ml');
  assert.strictEqual(proposeFor(hits[0], { ...DEFAULT_PREFS, cupStandard: 'au' }).text, '500 ml');
});
test('fixture: US recipe converts with the US cup standard', () => {
  const hits = docOf(['1 cup milk, 2 tbsp butter, 350°F, 1 lb flour, 8 fl oz cream'], { context: 'recipe', region: 'us', cupStandard: 'us' });
  assert.deepStrictEqual(hits.map((h) => h.raw), ['1 cup', '2 tbsp', '350°F', '1 lb', '8 fl oz']);
  const prefs = { ...DEFAULT_PREFS, cupStandard: 'us' };
  assert.strictEqual(proposeFor(hits[0], prefs).text, '236.6 ml');
  assert.strictEqual(proposeFor(hits[2], prefs).text, '176.7 °C');
});
test('fixture: OCR page — digit fixes and low confidence are flagged', () => {
  const line = { text: 'Cut 1O0 mm and 25 mm lengths; width 3.5 m', segs: [{ start: 0, end: 4, conf: 95 }, { start: 4, end: 10, conf: 52 }, { start: 11, end: 41, conf: 91 }] };
  const hits = scanDocument([{ lines: [line], ocr: true }], { context: 'building' });
  const fixed = hits.find((h) => h.raw.includes('1O0'));
  assert.ok(fixed && fixed.values[0] === 100);
  assert.ok(flagCodes(fixed).includes('ocr-digit-fix'));
  assert.ok(flagCodes(fixed).includes('low-ocr'));
  assert.strictEqual(fixed.confidence, 'low');
  assert.ok(RANK(hits.find((h) => h.raw === '25 mm').confidence) === 3);
});
test('OCR corrections are not applied on non-OCR pages', () => assert.strictEqual(scan('Cut 1O0 mm').length, 0));
test('fixture: plan / spec sheet with "(mm)" header column', () => {
  const sheet = ['SCHEDULE OF OPENINGS', 'Mark   Type        Width (mm)   Height (mm)   Sill (mm)', 'W1     Awning      1200         900           900', 'D1     Hinged      820          2040          -', 'Slab thickness 100 mm, 600 x 600 mm pavers.'];
  const hits = docOf(sheet, { context: 'building' });
  assert.strictEqual(hits.filter((h) => h.fromHeader).length, 5);
  assert.ok(hits.some((h) => h.raw === '100 mm') && hits.some((h) => h.raw === '600 x 600 mm'));
});
test('fixture: phone-photo style short lines', () => {
  const hits = docOf(['PRODUCT SPEC', 'Cap. 1.5 L  Wt 750 g', 'Size 280 x 190 x 95 mm'], { context: 'product' }, true);
  assert.deepStrictEqual(hits.map((h) => h.raw), ['1.5 L', '750 g', '280 x 190 x 95 mm']);
});

// ── proposals and export ──
test('proposals: metric ↔ imperial targets', () => {
  const p = { ...DEFAULT_PREFS };
  assert.strictEqual(proposeFor(one("Height 6'"), p).text, '1.829 m');
  assert.strictEqual(proposeFor(one('Cut 1/4 inch'), p).text, '6.35 mm');
  assert.strictEqual(proposeFor(one('Cut 100 mm'), { ...p, system: 'imperial' }).text, '3.937 in');
  assert.strictEqual(proposeFor(one('Hot 400 °F'), p).text, '204.4 °C');
  assert.strictEqual(proposeFor(one('Sheet 1200 × 600 × 18 mm'), { ...p, system: 'imperial' }).text, '47.24 × 23.62 × 0.7087 in');
});
test('already in target system → same; per-group override wins', () => {
  assert.strictEqual(proposeFor(one('Cut 100 mm'), DEFAULT_PREFS).status, 'same');
  assert.strictEqual(proposeFor(one('Cut 100 mm'), { ...DEFAULT_PREFS, perGroupUnit: { length: 'length.centimetre' } }).text, '10 cm');
  assert.strictEqual(proposeFor(one('Cut 100 mm'), { ...DEFAULT_PREFS, perGroupSystem: { length: 'imperial' } }).text, '3.937 in');
});
test('groups with no system (time) offer no conversion by default', () => assert.strictEqual(proposeFor(one('Bake 25 min', { context: 'recipe' }), DEFAULT_PREFS).status, 'none'));
test('converted text export replaces accepted hits only', () => {
  const lines = [{ text: 'Bake at 350°F with 1 cup flour' }];
  const hits = scanDocument([{ lines, ocr: false }], { context: 'recipe' });
  const rows = hits.map((h, i) => ({ hit: h, proposal: proposeFor(h, DEFAULT_PREFS), status: i === 0 ? 'accepted' : 'ignored' }));
  assert.strictEqual(buildConvertedText([{ lines }], rows), 'Bake at 176.7 °C with 1 cup flour');
  assert.strictEqual(buildConvertedText([{ lines }], rows, { keepOriginal: true }), 'Bake at 350°F (176.7 °C) with 1 cup flour');
});
console.log(`\n${n} passed`);
