import assert from 'node:assert';
import { keepJobForReturn, shouldKeepJob, takeKeptJob } from './jobMemory.mjs';

assert.strictEqual(takeKeptJob(), null, 'nothing kept by default');
assert.strictEqual(shouldKeepJob('a'), false);
keepJobForReturn('a');
assert.strictEqual(shouldKeepJob('a'), true, 'the marked job is kept on leaving');
assert.strictEqual(shouldKeepJob('b'), false, 'another job is not');
assert.strictEqual(shouldKeepJob(null), false);
assert.strictEqual(takeKeptJob(), 'a', 'restored once on return');
assert.strictEqual(takeKeptJob(), null, '...and only once');
keepJobForReturn(null);
assert.strictEqual(shouldKeepJob(null), false, 'marking nothing keeps nothing');

console.log('ok - job memory: kept across a trip to Video Tools, restored once');
