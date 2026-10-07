'use strict';

// node server/services/videoTools.test.js — pure helpers only, no ffmpeg/DB/network.

const assert = require('assert');
const { escapeDrawtext, escapeFilterPath } = require('./videoFfmpeg');
const { isBlockedPlatformHost } = require('./videoUrlIntake');
const { createJobGate } = require('./videoJobGate');
const { normalizeSlideshowPlan, buildPlannerPrompt } = require('./videoSlideshowPlan');
const { zoompanFor, wrapCaption } = require('./videoFfmpeg');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

(async () => {
  await test('escapeDrawtext escapes drawtext metacharacters', () => {
    assert.strictEqual(escapeDrawtext('50%: it\'s'), "50\\%\\: it'\\''s");
    assert.strictEqual(escapeDrawtext('a\\b'), 'a\\\\b');
  });

  await test('escapeDrawtext truncates before escaping (no dangling backslash)', () => {
    // 119 apostrophes then more: each escapes to 4 chars, so slicing AFTER escaping would
    // cut mid-sequence. Truncating first must keep every escape sequence whole.
    const out = escapeDrawtext("'".repeat(119) + 'abc');
    assert.strictEqual(out, "'\\''".repeat(119) + 'a');
    assert.ok(!/\\$/.test(out.replace(/\\\\/g, '')));
    assert.strictEqual(escapeDrawtext(null), '');
  });

  await test('escapeFilterPath normalises Windows paths and escapes colons/quotes', () => {
    assert.strictEqual(escapeFilterPath('C:\\tmp\\it\'s.srt'), "C\\:/tmp/it\\'s.srt");
  });

  await test('isBlockedPlatformHost blocks platform pages and subdomains only', () => {
    assert.ok(isBlockedPlatformHost('youtube.com'));
    assert.ok(isBlockedPlatformHost('WWW.YouTube.com'));
    assert.ok(isBlockedPlatformHost('player.vimeo.com'));
    assert.ok(isBlockedPlatformHost('youtu.be'));
    assert.ok(!isBlockedPlatformHost('notyoutube.com'));
    assert.ok(!isBlockedPlatformHost('cdn.example.com'));
  });

  await test('job gate limits concurrency and queues the rest', async () => {
    const gate = createJobGate({ maxConcurrent: 2, maxQueue: 10 });
    let running = 0;
    let peak = 0;
    const job = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 15));
      running -= 1;
    };
    await Promise.all(Array.from({ length: 6 }, () => gate.run(job)));
    assert.strictEqual(peak, 2);
    assert.deepStrictEqual(gate.stats(), { active: 0, queued: 0, maxConcurrent: 2, maxQueue: 10 });
  });

  await test('job gate rejects with VIDEO_BUSY when the queue is full', async () => {
    const gate = createJobGate({ maxConcurrent: 1, maxQueue: 1 });
    let release;
    const blocker = gate.run(() => new Promise((r) => { release = r; }));
    const queued = gate.run(async () => 'queued');
    await assert.rejects(() => gate.run(async () => 'overflow'), (err) => err.code === 'VIDEO_BUSY');
    release();
    await blocker;
    assert.strictEqual(await queued, 'queued');
  });

  await test('job gate releases its slot when a job throws', async () => {
    const gate = createJobGate({ maxConcurrent: 1, maxQueue: 1 });
    await assert.rejects(() => gate.run(async () => { throw new Error('boom'); }), /boom/);
    assert.strictEqual(await gate.run(async () => 'next'), 'next');
  });

  await test('plan: bad/missing input still yields a complete valid plan', () => {
    const plan = normalizeSlideshowPlan(null, 3);
    assert.deepStrictEqual(plan.slides.map((s) => s.index), [0, 1, 2]);
    assert.strictEqual(plan.transition, 'cut');
    assert.strictEqual(plan.transitionSec, 0);
    assert.strictEqual(plan.aspect, '9:16');
  });

  await test('plan: drops invalid/duplicate indices, appends forgotten images, keeps order', () => {
    const plan = normalizeSlideshowPlan({
      slides: [{ index: 2 }, { index: 2 }, { index: 9 }, { index: -1 }, { index: 'x' }, { index: 0 }],
    }, 4);
    assert.deepStrictEqual(plan.slides.map((s) => s.index), [2, 0, 1, 3]);
  });

  await test('plan: clamps enums, durations, transition time and caption text', () => {
    const plan = normalizeSlideshowPlan({
      aspect: '21:9', mode: 'stretch', transition: 'rm -rf', transitionSec: 99, motion: 'spin', mood: 'neon',
      captionPosition: 'left',
      slides: [{ index: 0, durationSec: 500, caption: `a\u0000b\nc${'x'.repeat(200)}` }, { index: 1, durationSec: -4 }],
    }, 2);
    assert.strictEqual(plan.aspect, '9:16');
    assert.strictEqual(plan.mode, 'pad');
    assert.strictEqual(plan.transition, 'cut');
    assert.strictEqual(plan.motion, 'none');
    assert.strictEqual(plan.mood, 'none');
    assert.strictEqual(plan.captionPosition, 'bottom-center');
    assert.strictEqual(plan.slides[0].durationSec, 15);
    assert.strictEqual(plan.slides[1].durationSec, 1);
    assert.ok(plan.slides[0].caption.length <= 80);
    assert.ok(!/[\u0000-\u001f]/.test(plan.slides[0].caption));
    const fade = normalizeSlideshowPlan({ transition: 'fade', transitionSec: 99 }, 2);
    assert.strictEqual(fade.transitionSec, 2);
  });

  await test('plan: total length is capped', () => {
    const slides = Array.from({ length: 20 }, (_, index) => ({ index, durationSec: 15 }));
    const plan = normalizeSlideshowPlan({ slides }, 20);
    assert.ok(plan.slides.reduce((n, s) => n + s.durationSec, 0) <= 181);
  });

  await test('plan prompt lists every image by index and carries the description', () => {
    const prompt = buildPlannerPrompt('calm and elegant', [{ name: 'a.jpg' }, { name: 'b.jpg' }], true);
    assert.ok(prompt.includes('0: a.jpg') && prompt.includes('1: b.jpg'));
    assert.ok(prompt.includes('calm and elegant'));
  });

  await test('zoompanFor: static for none, expression per move, no commas (filtergraph-safe)', () => {
    assert.strictEqual(zoompanFor('none', 90, 720, 1280), null);
    for (const m of ['zoom-in', 'zoom-out', 'pan-left', 'pan-right']) {
      const z = zoompanFor(m, 90, 720, 1280);
      assert.ok(z.startsWith('zoompan=') && z.includes('d=90') && z.includes('s=720x1280'), m);
      assert.ok(!z.includes(','), m);
    }
  });

  await test('wrapCaption wraps at word boundaries', () => {
    assert.strictEqual(wrapCaption('one two three four', 9), 'one two\nthree\nfour');
    assert.strictEqual(wrapCaption('', 10), '');
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
