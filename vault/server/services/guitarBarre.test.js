'use strict';
// node server/services/guitarBarre.test.js
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { STAGE_IDS, HOLD_SECONDS, CLEAR_AT, checkHold, summarise } = require('./guitarBarre');

assert.strictEqual(checkHold({ stage: 'full-f', clean: true, seconds: 10 }).ok, true);
assert.deepStrictEqual(checkHold({ stage: 'full-f', clean: false }).value, { stage: 'full-f', clean: false, seconds: 10 }, 'seconds default to a full hold');
assert.strictEqual(checkHold({ stage: 'nonsense', clean: true }).ok, false);
assert.strictEqual(checkHold({ stage: 'mini-f', clean: 'yes' }).ok, false, 'clean must be true or false');
assert.strictEqual(checkHold({ stage: 'mini-f' }).ok, false);
assert.strictEqual(checkHold({ stage: 'mini-f', clean: true, seconds: 3 }).ok, false, 'a short hold is not saved');
assert.strictEqual(checkHold({ stage: 'mini-f', clean: true, seconds: 61 }).ok, false);
assert.strictEqual(checkHold({ stage: 'mini-f', clean: true, seconds: 10.5 }).ok, false);

const d = (n) => new Date(Date.now() - n * 86400000).toISOString();
const sum = summarise([
  { stage: 'two-strings', clean: true, heldAt: d(5) }, { stage: 'two-strings', clean: true, heldAt: d(3) },
  { stage: 'two-strings', clean: false, heldAt: d(2) }, { stage: 'two-strings', clean: true, heldAt: d(1) },
  { stage: 'mini-f', clean: true, heldAt: d(1) }, { stage: 'bogus', clean: true, heldAt: d(1) },
]);
assert.deepStrictEqual(Object.keys(sum), STAGE_IDS);
assert.strictEqual(sum['two-strings'].clean, 3);
assert.strictEqual(sum['two-strings'].total, 4);
assert.strictEqual(sum['two-strings'].cleared, true);
assert.strictEqual(sum['two-strings'].lastAt, d(1));
assert.strictEqual(sum['mini-f'].cleared, false);
assert.strictEqual(sum['full-f'].total, 0);
assert.strictEqual(sum['full-f'].lastAt, null);
assert.deepStrictEqual(summarise([]), summarise(null));

// The client keeps the same rungs and numbers: they must not drift
(async () => {
  const client = await import(pathToFileURL(path.join(__dirname, '../../client/src/pages/guitar/barreStages.mjs')).href);
  assert.deepStrictEqual(client.STAGES.map(s => s.id), STAGE_IDS, 'server and client rungs match');
  assert.strictEqual(client.HOLD_SECONDS, HOLD_SECONDS);
  assert.strictEqual(client.CLEAR_AT, CLEAR_AT);
  console.log('guitarBarre tests passed');
})().catch(e => { console.error(e); process.exit(1); });
