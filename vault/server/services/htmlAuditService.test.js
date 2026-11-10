'use strict';

// node server/services/htmlAuditService.test.js   (Page speed: ticking actions done). No database.

const assert = require('assert');
const Module = require('module');

// Stub the db so requiring the service does not open a pool.
const origLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === '../db') return { pool: {} };
  return origLoad.call(this, request, ...rest);
};
const { applyActionUpdate } = require('./htmlAuditService');
Module._load = origLoad;

const t1 = new Date('2026-11-10T01:00:00Z');
const t2 = new Date('2026-11-11T01:00:00Z');

let s = applyActionUpdate({}, { view: 'mobile', key: 'redirects', done: true }, t1);
assert.deepStrictEqual(s.mobile.redirects, { done: true, doneAt: t1.toISOString(), note: '' });

s = applyActionUpdate(s, { view: 'mobile', key: 'redirects', note: '  Fixed in Cloudflare  ' }, t2);
assert.strictEqual(s.mobile.redirects.note, 'Fixed in Cloudflare', 'note is added and trimmed');
assert.strictEqual(s.mobile.redirects.doneAt, t1.toISOString(), 'a note does not move the done date');
assert.strictEqual(s.mobile.redirects.done, true, 'a note alone keeps done as it was');

s = applyActionUpdate(s, { view: 'mobile', key: 'redirects', done: false }, t2);
assert.deepStrictEqual(s.mobile.redirects, { done: false, doneAt: null, note: 'Fixed in Cloudflare' }, 'untick keeps the note');

s = applyActionUpdate(s, { view: 'mobile', key: 'redirects', note: '' }, t2);
assert.ok(!('redirects' in s.mobile), 'not done and no note -> removed');

s = applyActionUpdate(s, { view: 'desktop', key: 'image-alt', done: true }, t2);
assert.ok(s.desktop['image-alt'].done && s.mobile, 'devices are separate');

const origIn = { mobile: { a: { done: true } } };
applyActionUpdate(origIn, { view: 'mobile', key: 'b', done: true });
assert.ok(!origIn.mobile.b, 'input is not mutated');

for (const bad of [{ view: 'tablet', key: 'x' }, { view: 'mobile', key: '' }, { view: 'mobile', key: 'x'.repeat(161) }]) {
  assert.throws(() => applyActionUpdate({}, bad), (e) => e.status === 400);
}
assert.strictEqual(applyActionUpdate({}, { view: 'mobile', key: 'k', done: true, note: 'x'.repeat(5000) }).mobile.k.note.length, 1000, 'note is capped');

console.log('htmlAuditService tests passed');
