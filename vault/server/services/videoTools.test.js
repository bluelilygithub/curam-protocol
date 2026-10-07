'use strict';

// node server/services/videoTools.test.js — pure helpers only, no ffmpeg/DB/network.

const assert = require('assert');
const { escapeDrawtext, escapeFilterPath } = require('./videoFfmpeg');
const { isBlockedPlatformHost } = require('./videoUrlIntake');
const { createJobGate } = require('./videoJobGate');

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

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
