// node client/src/pages/music/musicProgress.test.mjs
import assert from 'node:assert';
import { musicProgressSteps, musicProgressPercent, formatElapsed } from './musicProgress.mjs';

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`); }
const opts = (...statuses) => statuses.map((status, n) => ({ n, status, error: status === 'failed' ? 'boom' : null }));
const statusOf = (steps) => steps.map((s) => s.status).join(',');

test('right after upload: three waiting options, nothing finishing yet', () => {
  const steps = musicProgressSteps({ durationS: 12, hasAudio: true, options: opts('pending', 'pending', 'pending') });
  assert.strictEqual(steps.length, 6);
  assert.strictEqual(statusOf(steps), 'done,done,pending,pending,pending,pending');
  assert.ok(steps[1].label.includes('12s'));
});

test('each option shows its own stage', () => {
  const steps = musicProgressSteps({ durationS: 30, options: opts('generating', 'fitting', 'ready') });
  assert.strictEqual(statusOf(steps), 'done,done,active,active,done,pending');
  assert.ok(/Composing option 1/.test(steps[2].label));
  assert.ok(/Cutting option 2/.test(steps[3].label));
  assert.ok(/Option 3 is ready/.test(steps[4].label));
});

test('a failed option is an error row with the reason; finishing starts when all have settled', () => {
  const steps = musicProgressSteps({ durationS: 30, options: opts('ready', 'failed', 'ready') });
  assert.strictEqual(steps[3].status, 'error');
  assert.ok(steps[3].label.includes('boom'));
  assert.strictEqual(steps[steps.length - 1].status, 'active');
  assert.strictEqual(steps[steps.length - 1].label, 'Finishing up');
});

test('no-sound videos are called out; missing job still renders a sane list', () => {
  assert.ok(musicProgressSteps({ durationS: 8, hasAudio: false, options: opts('pending') })[1].label.includes('no sound'));
  const empty = musicProgressSteps(null);
  assert.strictEqual(empty.length, 6);
  assert.strictEqual(empty[1].status, 'active');
});

test('percent is weighted by stage and bounded', () => {
  assert.strictEqual(musicProgressPercent({ options: opts('pending', 'pending', 'pending') }), 0);
  assert.strictEqual(musicProgressPercent({ options: opts('ready', 'ready', 'failed') }), 100);
  const mid = musicProgressPercent({ options: opts('generating', 'fitting', 'ready') });
  assert.ok(mid > 40 && mid < 90, mid);
  assert.strictEqual(musicProgressPercent(null), 0);
});

test('own-track job: single step, no composing wording', () => {
  const steps = musicProgressSteps({ source: 'upload', durationS: 20, hasAudio: true, options: [{ n: 0, status: 'fitting' }] });
  const track = steps.find((s) => s.id === 'option-0');
  assert.strictEqual(track.status, 'active');
  assert.ok(!/compos/i.test(track.label), track.label);
  const done = musicProgressSteps({ source: 'upload', options: [{ n: 0, status: 'ready' }] }).find((s) => s.id === 'option-0');
  assert.strictEqual(done.status, 'done');
});

test('elapsed formatting', () => {
  assert.strictEqual(formatElapsed(0), '0s');
  assert.strictEqual(formatElapsed(59000), '59s');
  assert.strictEqual(formatElapsed(61000), '1m 1s');
  assert.strictEqual(formatElapsed(-5), '0s');
});

console.log(`\n${passed} passed`);
