'use strict';

// node server/services/pcHealthCleanup.test.js   (npm run test:pc-health). Pure code: what may be offered and what the helper may report.

const assert = require('assert');
const { CLEANABLE_IDS, candidatesFor, cleanItemIds, sanitizeResults } = require('./pcHealthCleanup');

const L = (kind, path, sizeMB) => ({ kind, path, sizeMB, note: '' });
const report = { leftovers: [
  L('temp', 'C:\\Users\\micha\\AppData\\Local\\Temp', 771.4),
  L('temp', 'C:\\Windows\\Temp', 300),                                       // Windows' own Temp: needs admin, not on the list
  L('package-cache', 'C:\\Users\\micha\\AppData\\Local\\npm-cache', 11163.7),
  L('package-cache', 'C:\\Users\\micha\\.nuget\\packages', 386.6),           // not a pure cache: never offered
  L('cache', 'C:\\Users\\micha\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache', 256),
  L('recycle-bin', 'C:\\$Recycle.Bin', 1106),
  L('crash-dump', 'C:\\Users\\micha\\AppData\\Local\\CrashDumps', 379),
  L('installer', 'C:\\Users\\micha\\Downloads\\Docker Desktop Installer.exe', 603),
  L('package-cache', 'C:\\Users\\micha\\AppData\\Local\\pip\\Cache', 90),
  L('package-cache', 'D:\\evil\\AppData\\Local\\npm-cache\\..\\..\\..\\Windows', 5000),   // a look-alike path is not a match
  L('temp', 'C:\\Users\\micha\\AppData\\Local\\Temp\\..\\..\\..', 5000),
] };

const c = candidatesFor(report);
assert.deepStrictEqual(c.map((x) => x.id), ['npm-cache', 'temp-user', 'pip-cache'], 'only the four known locations, biggest first');
assert.strictEqual(c[0].sizeMB, 11163.7);
assert.ok(c.every((x) => x.removes && x.safe && x.after && x.label && x.path), 'every offer says what, why it is safe and what happens after');
assert.ok(!c.some((x) => /Windows|nuget|Chrome|Recycle|Downloads|CrashDumps/i.test(x.path)), 'nothing outside the list is offered');
assert.deepStrictEqual(candidatesFor(null), []);
assert.deepStrictEqual(candidatesFor({}), []);
assert.deepStrictEqual(candidatesFor({ leftovers: [L('temp', 'C:\\Users\\micha\\AppData\\Local\\Temp', 1), L('temp', 'C:\\Users\\micha\\AppData\\Local\\Temp', 2)] }).length, 1, 'no duplicates');

// a request can name only ids on the list, once each
assert.deepStrictEqual(cleanItemIds(['npm-cache', 'npm-cache', 'C:\\Windows', '../x', 5, null, 'temp-user']), ['npm-cache', 'temp-user']);
assert.deepStrictEqual(cleanItemIds('npm-cache'), []);
assert.deepStrictEqual(cleanItemIds(undefined), []);
assert.deepStrictEqual([...CLEANABLE_IDS].sort(), ['npm-cache', 'pip-cache', 'temp-user', 'yarn-cache']);

// the helper's result is untrusted too: only the requested items, bounded numbers, no control characters
const res = sanitizeResults({ results: [
  { id: 'npm-cache', ok: true, freedMB: 10900.44, filesRemoved: 5000, skipped: 2, note: 'fine\u0000\u001b' },
  { id: 'C:\\Windows', ok: true, freedMB: 99999 },                  // not requested: dropped
  { id: 'temp-user', ok: 'yes', freedMB: -5, filesRemoved: 'x' },    // junk: zeros, not ok
] }, ['npm-cache', 'temp-user', 'pip-cache']);
assert.deepStrictEqual(res.map((r) => r.id), ['npm-cache', 'temp-user', 'pip-cache']);
assert.strictEqual(res[0].freedMB, 10900.4);
assert.ok(!/[\u0000-\u001f]/.test(res[0].note));
assert.strictEqual(res[1].ok, false); assert.strictEqual(res[1].freedMB, 0); assert.strictEqual(res[1].filesRemoved, 0);
assert.strictEqual(res[2].ok, false, 'an item the helper did not report is not marked done');
assert.deepStrictEqual(sanitizeResults(null, ['temp-user']).map((r) => r.ok), [false]);

console.log('pcHealthCleanup tests passed');
