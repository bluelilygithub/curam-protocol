'use strict';

// node server/services/noteDay.test.js   (part of npm run test:notes)

const assert = require('assert');
const { validDay } = require('./noteDay');

assert.strictEqual(validDay('2026-10-23'), '2026-10-23');
assert.strictEqual(validDay(' 2026-10-23 '), '2026-10-23');
assert.strictEqual(validDay('2026-02-30'), null);
assert.strictEqual(validDay('23/10/2026'), null);
assert.strictEqual(validDay(undefined), null);
assert.strictEqual(validDay('2028-02-29'), '2028-02-29', 'leap day');
assert.strictEqual(validDay('2027-02-29'), null);

console.log('noteDay tests passed');
