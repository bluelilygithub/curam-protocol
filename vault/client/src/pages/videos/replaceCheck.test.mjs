import assert from 'node:assert/strict';
import { describeFit, TOLERANCE_SEC } from './replaceCheck.mjs';

assert.equal(TOLERANCE_SEC, 0.1);

let r = describeFit(12, 12);
assert.deepEqual([r.state, r.ok], ['ok', true]);
assert.match(r.text, /Lengths match.*12\.0 s/);

r = describeFit(12, 12.06);
assert.deepEqual([r.state, r.ok], ['fixed', true]);
assert.match(r.text, /fixed for you/);
r = describeFit(12, 11.95);
assert.equal(r.state, 'fixed');
assert.equal(describeFit(12, 12.1).state, 'fixed', 'exactly a tenth is still fixed');

r = describeFit(12, 12.5);
assert.deepEqual([r.state, r.ok], ['long', false]);
assert.match(r.text, /0\.5 s too long.*Trim 0\.5 s off the clip in Clip \/ trim first/);
r = describeFit(12, 11.2);
assert.deepEqual([r.state, r.ok], ['short', false]);
assert.match(r.text, /0\.8 s too short.*Use a clip that is 12\.0 s long/);

// before everything is chosen
assert.equal(describeFit(0, 12).state, 'unknown');
assert.match(describeFit(0, 12).text, /Set the start/);
assert.equal(describeFit(12, 0).state, 'unknown');
assert.match(describeFit(12, null).text, /Choose the replacement clip/);
assert.equal(describeFit(undefined, undefined).ok, false);

// the same numbers the server uses: identical wording for the same case
assert.match(describeFit(12.0, 12.5).text, /the section is 12\.0 s, the clip is 12\.5 s/);

console.log('replaceCheck tests passed');
