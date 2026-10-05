#!/usr/bin/env node
/**
 * Spoken number + command parser tests.
 * Run: node client/src/utils/units/voice.test.mjs
 */
import assert from 'assert';
import { parseSpokenNumber, parseSpokenCommand, parseSpokenUnit, numberWordsToDigits } from './voiceParser.mjs';

let n = 0;
function test(name, fn) {
  try { fn(); n += 1; console.log(`PASS  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

const NUMBERS = [
  ['five', 5], ['twenty-three', 23], ['twenty three', 23], ['one hundred and twenty', 120], ['twelve hundred', 1200],
  ['one and a half', 1.5], ['two and three quarters', 2.75], ['three quarters', 0.75], ['a quarter', 0.25], ['half', 0.5],
  ['a half', 0.5], ['point five', 0.5], ['two point five', 2.5], ['three point one four', 3.14], ['minus ten', -10],
  ['negative five point five', -5.5], ['one thousand two hundred', 1200], ['1.5', 1.5], ['1,200', 1200], ['2 1/4', 2.25], ['¾', 0.75],
];
for (const [t, v] of NUMBERS) test(`number: "${t}" → ${v}`, () => assert.ok(Math.abs(parseSpokenNumber(t) - v) < 1e-9, `got ${parseSpokenNumber(t)}`));
test('non-numbers return null', () => { assert.strictEqual(parseSpokenNumber('flour'), null); assert.strictEqual(parseSpokenNumber(''), null); });
test('numberWordsToDigits keeps unit words', () => assert.strictEqual(numberWordsToDigits('twelve hundred millimetres'), '1200 millimetres'));

const cmd = (t, o) => parseSpokenCommand(t, o);
test('"five feet eleven in centimetres" → compound ft+in → cm', () => {
  const r = cmd('five feet eleven in centimetres');
  assert.ok(r.ok); assert.deepStrictEqual(r.parts, [5, 11]); assert.strictEqual(r.fromId, 'length.ftin'); assert.strictEqual(r.toId, 'length.centimetre');
});
test('"five feet in centimetres" (in is a connector)', () => {
  const r = cmd('five feet in centimetres');
  assert.ok(r.ok); assert.strictEqual(r.value, 5); assert.strictEqual(r.fromId, 'length.foot'); assert.strictEqual(r.toId, 'length.centimetre');
});
test('"5 cm to in" (in as the target unit)', () => {
  const r = cmd('5 cm to in');
  assert.ok(r.ok); assert.strictEqual(r.toId, 'length.inch');
});
test('"two cups of flour in grams" fills ingredient + cooking group', () => {
  const r = cmd('two cups of flour in grams');
  assert.ok(r.ok); assert.strictEqual(r.value, 2); assert.strictEqual(r.fromId, 'cooking.cup'); assert.strictEqual(r.toId, 'cooking.g'); assert.strictEqual(r.ingredientId, 'plain-flour');
});
test('"one and a half cups of caster sugar to grams"', () => {
  const r = cmd('one and a half cups of caster sugar to grams');
  assert.ok(r.ok); assert.strictEqual(r.value, 1.5); assert.strictEqual(r.ingredientId, 'caster-sugar');
});
test('"thirty degrees Celsius to Fahrenheit"', () => {
  const r = cmd('thirty degrees Celsius to Fahrenheit');
  assert.ok(r.ok); assert.strictEqual(r.value, 30); assert.strictEqual(r.fromId, 'temperature.celsius'); assert.strictEqual(r.toId, 'temperature.fahrenheit');
});
test('"350 fahrenheit to gas mark"', () => {
  const r = cmd('350 fahrenheit to gas mark');
  assert.ok(r.ok); assert.strictEqual(r.toId, 'temperature.gasmark');
});
test('"how many millilitres in half a cup" (amount after the connector)', () => {
  const r = cmd('how many millilitres in half a cup');
  assert.ok(r.ok); assert.strictEqual(r.value, 0.5); assert.strictEqual(r.fromId, 'volume.cup'); assert.strictEqual(r.toId, 'volume.millilitre');
});
test('"what is a quarter cup of butter in grams"', () => {
  const r = cmd('what is a quarter cup of butter in grams');
  assert.ok(r.ok); assert.strictEqual(r.value, 0.25); assert.strictEqual(r.ingredientId, 'butter');
});
test('"ten stone four pounds in kilograms" → stone+pounds compound', () => {
  const r = cmd('ten stone four pounds in kilograms');
  assert.ok(r.ok); assert.strictEqual(r.fromId, 'mass.stlb'); assert.deepStrictEqual(r.parts, [10, 4]);
});
test('"one hour thirty minutes to hours"', () => {
  const r = cmd('one hour thirty minutes to hours');
  assert.ok(r.ok); assert.strictEqual(r.fromId, 'time.hmin');
});
test('regional gallon follows the region setting', () => {
  assert.strictEqual(cmd('5 gallons to litres', { region: 'us' }).fromId, 'volume.gallon_us');
  assert.strictEqual(cmd('5 gallons to litres', { region: 'imperial' }).fromId, 'volume.gallon_imp');
});
test('mpg follows the region setting', () => assert.strictEqual(cmd('30 mpg to litres per 100 kilometres', { region: 'us' }).fromId, 'fuel.mpg_us'));
test('units from different groups do not convert', () => assert.ok(!cmd('5 feet to grams').ok));
test('missing pieces are reported, not guessed', () => {
  assert.ok(!cmd('five feet').ok);
  assert.ok(cmd('five feet').notes.length > 0);
});
test('parseSpokenUnit', () => {
  assert.strictEqual(parseSpokenUnit('centimetres'), 'length.centimetre');
  assert.strictEqual(parseSpokenUnit('degrees celsius'), 'temperature.celsius');
  assert.strictEqual(parseSpokenUnit('kilometres per hour'), 'speed.kmh');
  assert.strictEqual(parseSpokenUnit('kPa'), 'pressure.kilopascal');
  assert.strictEqual(parseSpokenUnit('nonsense'), null);
});
console.log(`\n${n} passed`);
