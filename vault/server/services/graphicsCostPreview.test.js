'use strict';

// node server/services/graphicsCostPreview.test.js   (npm run test:graphics-cost)
const assert = require('assert');
const { buildCostPreview } = require('./graphicsCostPreview');

const one = buildCostPreview({ perRunUsd: 0.025, spentUsd: 0.5, capUsd: 5, estimate: true });
assert.strictEqual(one.totalUsd, 0.025);
assert.strictEqual(one.remainingUsd, 4.5);
assert.ok(!one.blocked && !one.overLimit && !one.free && one.estimate);

// A batch is priced as a whole, and the limit is checked for the whole job.
const batch = buildCostPreview({ perRunUsd: 0.02, runs: 25, spentUsd: 4.8, capUsd: 5 });
assert.strictEqual(batch.totalUsd, 0.5);
assert.ok(batch.overLimit && !batch.blocked);

// Limit already reached.
assert.ok(buildCostPreview({ perRunUsd: 0.02, spentUsd: 5, capUsd: 5 }).blocked);

// Free (local) work is never blocked or flagged, even over the limit.
const free = buildCostPreview({ perRunUsd: 0, runs: 25, spentUsd: 9, capUsd: 5 });
assert.ok(free.free && !free.blocked && !free.overLimit && !free.estimate);

// No price known (icons): no total, no over-limit guess, but the remaining limit is still reported.
const icons = buildCostPreview({ perRunUsd: null, spentUsd: 1, capUsd: 5 });
assert.ok(icons.unknown && icons.totalUsd === null && !icons.overLimit);
assert.strictEqual(icons.remainingUsd, 4);

// Limit switched off.
const none = buildCostPreview({ perRunUsd: 0.5, runs: 100, spentUsd: 99, capUsd: 0 });
assert.ok(none.capUsd === null && none.remainingUsd === null && !none.blocked && !none.overLimit);

// Bad run counts fall back to 1.
assert.strictEqual(buildCostPreview({ perRunUsd: 0.1, runs: 'x', spentUsd: 0, capUsd: 5 }).runs, 1);
console.log('graphicsCostPreview: ok');
