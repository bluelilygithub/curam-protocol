import assert from 'node:assert';
import { setToolHandoff, takeToolHandoff, clearToolHandoffs } from './toolHandoff.mjs';

clearToolHandoffs();
assert.strictEqual(takeToolHandoff('trim-audio'), null, 'nothing waiting by default');

const a = { name: 'a.wav' };
const b = { name: 'b.mp4' };
setToolHandoff('trim-audio', a);
setToolHandoff('normalize', b);
assert.strictEqual(takeToolHandoff('trim-audio'), a, 'each tool gets its own file');
assert.strictEqual(takeToolHandoff('trim-audio'), null, 'a file is handed over once');
assert.strictEqual(takeToolHandoff('normalize'), b, 'the other tool is untouched by that');

setToolHandoff('mix-audio', a);
setToolHandoff('mix-audio', b);
assert.strictEqual(takeToolHandoff('mix-audio'), b, 'a newer file replaces an older one');

setToolHandoff('own-track', a);
setToolHandoff('own-track', null);
assert.strictEqual(takeToolHandoff('own-track'), null, 'handing over nothing clears it');
setToolHandoff('', a);
assert.strictEqual(takeToolHandoff(''), null, 'no tool id, no handoff');

console.log('ok - tool handoff: per tool, once, newest wins');
