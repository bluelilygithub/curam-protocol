// node client/src/pages/graphics/costText.test.mjs
import assert from 'assert';
import { describeCost } from './costText.mjs';

const base = { free: false, unknown: false, estimate: true, runs: 1, perRunUsd: 0.025, totalUsd: 0.025, spentUsd: 0.5, capUsd: 5, remainingUsd: 4.5, blocked: false, overLimit: false };

assert.strictEqual(describeCost(null), null);
assert.strictEqual(describeCost({ ...base, free: true, perRunUsd: 0, totalUsd: 0 }).level, 'info');
assert.match(describeCost({ ...base, free: true }).text, /^Free/);

const one = describeCost(base);
assert.strictEqual(one.text, "Estimated cost: ~$0.025. $4.50 of today's $5.00 limit left.");

// A batch shows the sum for the whole job.
const batch = describeCost({ ...base, runs: 25, totalUsd: 0.625 });
assert.match(batch.text, /25 × \$0\.025 = \$0\.625/);

// Over the limit: still allowed to start, but warned.
const over = describeCost({ ...base, runs: 25, totalUsd: 0.625, spentUsd: 4.8, remainingUsd: 0.2, overLimit: true });
assert.strictEqual(over.level, 'warn');
assert.match(over.text, /past today's limit/);

// Limit used up.
assert.strictEqual(describeCost({ ...base, blocked: true, remainingUsd: 0 }).level, 'block');

// Icons: no price, only the remaining limit. No limit set: no "left" wording.
assert.match(describeCost({ ...base, unknown: true, perRunUsd: null, totalUsd: null }).text, /\$4\.50 of today's/);
assert.ok(!/limit left/.test(describeCost({ ...base, capUsd: null, remainingUsd: null }).text));

// A step that cannot run here is shown as blocked, in its own words.
assert.deepStrictEqual(describeCost({ ...base, unavailable: 'Upscale works on the live site only.' }), { text: 'Upscale works on the live site only.', level: 'block' });

console.log('costText: ok');
