#!/usr/bin/env node
/**
 * Measurement registry + conversion engine tests.
 * Run: node client/src/utils/units/units.test.mjs
 */
import assert from 'assert';
import { allUnits, unitsOfGroup, GROUPS, getUnit, INGREDIENTS, formatNumber, GAS_MARKS } from './registry.mjs';
import { convert, convertValues, formatResult, baseToCompound, conversionProblem } from './convert.mjs';

let n = 0;
function test(name, fn) {
  try { fn(); n += 1; console.log(`PASS  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `expected ${b}, got ${a}`);
const cx = { cupStandard: 'au', ingredient: 'plain-flour' };

// Known value pairs, both directions
const PAIRS = [
  [1, 'length.foot', 'length.metre', 0.3048],
  [1, 'length.inch', 'length.millimetre', 25.4],
  [1, 'length.mile', 'length.kilometre', 1.609344],
  [1, 'length.nauticalmile', 'length.metre', 1852],
  [1, 'length.yard', 'length.foot', 3],
  [1, 'area.acre', 'area.m2', 4046.8564224],
  [1, 'area.hectare', 'area.m2', 10000],
  [1, 'area.square', 'area.ft2', 100],
  [1, 'volume.gallon_us', 'volume.litre', 3.785411784],
  [1, 'volume.gallon_imp', 'volume.litre', 4.54609],
  [1, 'volume.gallon_us', 'volume.pint_us', 8],
  [1, 'volume.gallon_imp', 'volume.pint_imp', 8],
  [1, 'volume.ft3', 'volume.litre', 28.316846592],
  [1, 'mass.pound', 'mass.kilogram', 0.45359237],
  [1, 'mass.ounce', 'mass.gram', 28.349523125],
  [1, 'mass.stone', 'mass.pound', 14],
  [1, 'mass.shortton', 'mass.pound', 2000],
  [1, 'mass.longton', 'mass.pound', 2240],
  [100, 'temperature.celsius', 'temperature.fahrenheit', 212],
  [0, 'temperature.celsius', 'temperature.fahrenheit', 32],
  [-40, 'temperature.celsius', 'temperature.fahrenheit', -40],
  [0, 'temperature.celsius', 'temperature.kelvin', 273.15],
  [350, 'temperature.fahrenheit', 'temperature.celsius', 176.66666666667],
  [100, 'speed.kmh', 'speed.mph', 62.1371192237],
  [1, 'speed.knot', 'speed.kmh', 1.852],
  [1, 'time.year', 'time.day', 365.25],
  [1, 'pressure.atm', 'pressure.kilopascal', 101.325],
  [1, 'pressure.psi', 'pressure.kilopascal', 6.894757293168],
  [1, 'pressure.bar', 'pressure.kilopascal', 100],
  [1, 'energy.kcal', 'energy.kilojoule', 4.184],
  [1, 'energy.kwh', 'energy.kilojoule', 3600],
  [1, 'power.hp', 'power.watt', 745.69987158227],
  [1, 'data.kb', 'data.byte', 1000],
  [1, 'data.kib', 'data.byte', 1024],
  [1, 'data.gb', 'data.mb', 1000],
  [1, 'data.gib', 'data.mib', 1024],
  [8, 'data.bit', 'data.byte', 1],
  [100, 'datarate.mbps', 'datarate.mbytes', 12.5],
  [180, 'angle.degree', 'angle.radian', Math.PI],
  [90, 'angle.degree', 'angle.gradian', 100],
  [1, 'force.kgf', 'force.newton', 9.80665],
  [1, 'torque.ftlb', 'torque.nm', 1.3558179483314],
  [1, 'flow.m3h', 'flow.lmin', 1000 / 60],
  [1, 'flow.gpm_us', 'flow.lmin', 3.785411784],
];
for (const [v, a, b, expected] of PAIRS) {
  test(`${v} ${a} → ${b}`, () => near(convert(v, a, b, cx), expected, 1e-9));
  test(`${expected} ${b} → ${a} (reverse)`, () => near(convert(expected, b, a, cx), v, 1e-9));
}

test('AU tablespoon = 20 ml', () => near(convert(1, 'volume.tbsp', 'volume.millilitre', { cupStandard: 'au' }), 20));
test('US tablespoon = 14.787 ml', () => near(convert(1, 'volume.tbsp', 'volume.millilitre', { cupStandard: 'us' }), 14.787));
test('UK tablespoon = 15 ml', () => near(convert(1, 'volume.tbsp', 'volume.millilitre', { cupStandard: 'uk' }), 15));
test('AU cup 250 ml / US cup 236.588 ml', () => {
  near(convert(1, 'volume.cup', 'volume.millilitre', { cupStandard: 'au' }), 250);
  near(convert(1, 'volume.cup', 'volume.millilitre', { cupStandard: 'us' }), 236.588);
});
test('US gallon ≠ imperial gallon', () => assert.notStrictEqual(convert(1, 'volume.gallon_us', 'volume.litre'), convert(1, 'volume.gallon_imp', 'volume.litre')));
test('US pint ≠ imperial pint', () => assert.ok(Math.abs(convert(1, 'volume.pint_us', 'volume.millilitre') - convert(1, 'volume.pint_imp', 'volume.millilitre')) > 90));
test('KB (1000) vs KiB (1024)', () => near(convert(1, 'data.kib', 'data.kb'), 1.024));
test('°C ↔ °F uses the offset', () => { near(convert(37, 'temperature.celsius', 'temperature.fahrenheit'), 98.6); near(convert(98.6, 'temperature.fahrenheit', 'temperature.celsius'), 37); });
test('temperature difference: 10 °C change = 18 °F change', () => near(convert(10, 'temperature.celsius', 'temperature.fahrenheit', { tempMode: 'difference' }), 18));
test('temperature difference: 18 °F change = 10 K change', () => near(convert(18, 'temperature.fahrenheit', 'temperature.kelvin', { tempMode: 'difference' }), 10));
test('L/100 km ↔ mpg (US) inverse', () => {
  near(convert(8, 'fuel.l100', 'fuel.mpg_us'), 29.4018229, 1e-6);
  near(convert(30, 'fuel.mpg_us', 'fuel.l100'), 7.84048611, 1e-6);
  near(convert(8, 'fuel.l100', 'fuel.mpg_imp'), 35.3101, 1e-5);
  near(convert(10, 'fuel.l100', 'fuel.kml'), 10);
});
test('mpg US vs imperial differ', () => assert.ok(convert(30, 'fuel.mpg_us', 'fuel.l100') < convert(30, 'fuel.mpg_imp', 'fuel.l100')));
test('gas mark 4 = 180 °C = 356 °F', () => {
  near(convert(4, 'temperature.gasmark', 'temperature.celsius'), 180);
  near(convert(4, 'temperature.gasmark', 'temperature.fahrenheit'), 356);
});
test('gas mark lookup: 0.25 and unlisted marks', () => {
  near(convert(0.25, 'temperature.gasmark', 'temperature.celsius'), 110);
  assert.ok(Number.isNaN(convert(4.5, 'temperature.gasmark', 'temperature.celsius')));
});
test('°C → gas mark picks nearest', () => {
  assert.strictEqual(convert(182, 'temperature.celsius', 'temperature.gasmark'), 4);
  assert.strictEqual(convert(220, 'temperature.celsius', 'temperature.gasmark'), 7);
  assert.strictEqual(convert(105, 'temperature.celsius', 'temperature.gasmark'), 0.25);
});
test('gas mark rejects difference mode', () => assert.ok(conversionProblem('temperature.celsius', 'temperature.gasmark', { tempMode: 'difference' })));

// Cooking
test('1 cup plain flour (AU) = 150 g', () => near(convert(1, 'cooking.cup', 'cooking.g', cx), 150));
test('150 g plain flour = 1 cup', () => near(convert(150, 'cooking.g', 'cooking.cup', cx), 1));
test('1 tbsp water (AU) = 20 g', () => near(convert(1, 'cooking.tbsp', 'cooking.g', { cupStandard: 'au', ingredient: 'water' }), 20));
test('US cup of water ≈ 236.588 g', () => near(convert(1, 'cooking.cup', 'cooking.g', { cupStandard: 'us', ingredient: 'water' }), 236.588));
test('cooking without ingredient is NaN + flagged', () => {
  assert.ok(Number.isNaN(convert(1, 'cooking.cup', 'cooking.g', { cupStandard: 'au' })));
  assert.ok(conversionProblem('cooking.cup', 'cooking.g', { cupStandard: 'au' }));
});
test('every ingredient has density, source, approximate flag', () => {
  assert.ok(INGREDIENTS.length >= 20);
  for (const i of INGREDIENTS) { assert.ok(i.gPerCup > 0 && i.source && i.approximate); }
});

// Compound
test('5 ft 11 in → 1.8034 m', () => near(convertValues([5, 11], 'length.ftin', 'length.metre').value, 1.8034));
test('1.8034 m → 5 ft 11 in', () => {
  const r = convertValues(1.8034, 'length.metre', 'length.ftin');
  assert.deepStrictEqual(r.parts.map((x) => Math.round(x * 100) / 100), [5, 11]);
  assert.strictEqual(formatResult(r, 'length.ftin', { mode: 'dp', n: 1 }), '5 ft 11 in');
});
test('compound carry: 11.999 in becomes next foot', () => {
  const parts = baseToCompound(getUnit('length.ftin'), 0.3048 * 5 + 0.0254 * 11.9999, {}, 2);
  assert.deepStrictEqual(parts, [6, 0]);
});
test('10 st 4 lb → kg', () => near(convertValues([10, 4], 'mass.stlb', 'mass.kilogram').value, 65.31730128, 1e-6));
test('1 h 30 min → 1.5 h', () => near(convertValues([1, 30], 'time.hmin', 'time.hour').value, 1.5));
test('2.25 h → 2 h 15 min', () => assert.deepStrictEqual(convertValues(2.25, 'time.hour', 'time.hmin').parts, [2, 15]));
test('DMS 45° 30′ 0″ → 45.5°', () => near(convertValues([45, 30, 0], 'angle.dms', 'angle.degree').value, 45.5));

// Edge cases + round trip
test('zero converts to zero (factor units)', () => near(convert(0, 'length.foot', 'length.metre'), 0));
test('negatives are valid where meaningful', () => { near(convert(-5, 'length.metre', 'length.foot'), -16.404199475); near(convert(-10, 'temperature.celsius', 'temperature.fahrenheit'), 14); });
test('very large and very small', () => {
  near(convert(1e12, 'length.metre', 'length.kilometre'), 1e9);
  near(convert(1e-9, 'length.metre', 'length.millimetre'), 1e-6, 1e-9);
});
test('no floating-point artefacts in display', () => {
  assert.strictEqual(formatNumber(0.1 + 0.2), '0.3');
  assert.strictEqual(formatNumber(convert(3, 'length.foot', 'length.inch')), '36');
  assert.strictEqual(formatNumber(1.8288), '1.8288');
});
test('precision modes', () => {
  assert.strictEqual(formatNumber(3.14159265, { mode: 'dp', n: 2 }), '3.14');
  assert.strictEqual(formatNumber(1234.5678, { mode: 'sig', n: 3 }), '1230');
  assert.strictEqual(formatNumber(0.000123456, { mode: 'sig', n: 3 }), '0.000123');
  assert.strictEqual(formatNumber(1e-9, { mode: 'sig', n: 3 }), '1e-9');
});

test('every group has units and every unit is complete', () => {
  for (const g of GROUPS) assert.ok(unitsOfGroup(g.id).length >= 2, `${g.id} has <2 units`);
  for (const u of allUnits()) {
    assert.ok(u.name && u.plural && u.system && u.source, `${u.id} missing fields`);
    assert.ok(u.formulaText, `${u.id} missing formula text`);
    assert.ok(u.exampleText, `${u.id} missing example`);
  }
});
test('round trip A → B → A across every unit pair in every group', () => {
  let checked = 0;
  for (const g of GROUPS) {
    const us = unitsOfGroup(g.id).filter((u) => u.type !== 'compound' && u.type !== 'lookup');
    for (const a of us) for (const b of us) {
      for (const v of [0.37, 1, 250]) {
        const ctxs = [{ cupStandard: 'au', ingredient: 'milk' }, { cupStandard: 'us', ingredient: 'honey' }];
        for (const c of ctxs) {
          const there = convert(v, a.id, b.id, c);
          const back = convert(there, b.id, a.id, c);
          near(back, v, 1e-9);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 5000);
});
test('gas mark table is monotonic', () => { for (let i = 1; i < GAS_MARKS.length; i += 1) assert.ok(GAS_MARKS[i][1] > GAS_MARKS[i - 1][1]); });

console.log(`\n${n} passed`);
