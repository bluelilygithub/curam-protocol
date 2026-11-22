'use strict';

// node server/services/youtubeDownload.test.js   (YouTube Download and Chapters). yt-dlp is faked; nothing touches the network.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('./youtubeDownload');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  await t('description chapters: YouTube rules (start at 0:00, three or more, ascending)', () => {
    const desc = 'Intro text\n0:00 Intro\n1:05 - Setup\n(12:30) The fix\n1:02:03 | Wrap up\n0:30 not ascending, skipped';
    assert.deepStrictEqual(D.parseDescriptionChapters(desc), [
      { start: 0, title: 'Intro' }, { start: 65, title: 'Setup' }, { start: 750, title: 'The fix' }, { start: 3723, title: 'Wrap up' }]);
    assert.deepStrictEqual(D.parseDescriptionChapters('0:00 a\n1:00 b'), [], 'two is not enough');
    assert.deepStrictEqual(D.parseDescriptionChapters('0:10 a\n1:00 b\n2:00 c'), [], 'must start at 0:00');
    assert.deepStrictEqual(D.parseDescriptionChapters(''), []);
  });

  await t('yt-dlp chapters, progress, file names, errors', () => {
    assert.deepStrictEqual(D.chaptersFromInfo({ chapters: [{ start_time: 0, title: 'A' }, { start_time: 90.6, title: '' }] }), [{ start: 0, title: 'A' }, { start: 90, title: 'Chapter' }]);
    assert.deepStrictEqual(D.chaptersFromInfo({}), []);
    assert.strictEqual(D.parseProgress('[download]  42.3% of 10.00MiB at 1MiB/s'), 42.3);
    assert.strictEqual(D.parseProgress('[Merger] Merging formats'), null);
    assert.strictEqual(D.safeName('How to: fix <it>/now?', 'mp4'), 'How to fix itnow.mp4');
    assert.strictEqual(D.safeName('', 'mp3'), 'youtube-video.mp3');
    assert.match(D.friendlyError('ERROR: Sign in to confirm you are not a bot'), /blocked this server as a bot/);
    assert.match(D.friendlyError('ERROR: Private video'), /private/);
    assert.match(D.friendlyError('something odd'), /download failed/);
  });

  await t('download job: progress, finished file for its owner only, one per person, cleanup', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-test-'));
    const releases = [];
    const run = (args, { onLine }) => new Promise((resolve) => {
      const out = args[args.indexOf('-o') + 1];
      onLine('[download]  50.0% of 1MiB');
      releases.push(() => { fs.writeFileSync(out.replace('%(ext)s', 'f137.mp4'), 'part'); fs.writeFileSync(out.replace('%(ext)s', 'mp4'), 'video'); resolve({ code: 0, tail: '' }); });
    });
    const dl = D.createDownloads({ run, tmpRoot });
    assert.strictEqual(dl.start(1, 'abc', 'nope', 'x').status, 400);
    const { job } = dl.start(1, 'abcdefghijk', 'video720', 'My video');
    await tick();
    assert.strictEqual(dl.status(1, job.id).percent, 50);
    assert.strictEqual(dl.status(2, job.id), null, 'another person cannot see it');
    assert.strictEqual(dl.start(1, 'abcdefghijk', 'audio', 'x').status, 409, 'one at a time per person');
    assert.ok(dl.start(2, 'abcdefghijk', 'audio', 'x').job, 'another person can start one');
    assert.strictEqual(dl.start(3, 'abcdefghijk', 'audio', 'x').status, 429, 'server-wide limit');
    releases.forEach((r) => r());
    await tick(); await tick();
    const st = dl.status(1, job.id);
    assert.strictEqual(st.status, 'done');
    assert.strictEqual(st.filename, 'My video.mp4');
    assert.strictEqual(st.size, 5, 'the merged file, not the part');
    assert.strictEqual(dl.file(2, job.id), null);
    const f = dl.file(1, job.id);
    assert.strictEqual(fs.readFileSync(f.file, 'utf8'), 'video');
    dl.remove(job.id);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!fs.existsSync(path.dirname(f.file)), 'the temp folder is deleted');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await t('download job: a yt-dlp failure becomes a plain error and leaves no folder', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-test-'));
    const dl = D.createDownloads({ run: async () => ({ code: 1, tail: 'ERROR: Video unavailable' }), tmpRoot });
    const { job } = dl.start(1, 'abcdefghijk', 'audio', 'x');
    await tick(); await tick();
    assert.strictEqual(dl.status(1, job.id).status, 'error');
    assert.match(dl.status(1, job.id).error, /private or no longer available/);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(fs.readdirSync(tmpRoot), []);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await t('chapters: description first, yt-dlp only when it has none, cached, errors not cached', async () => {
    let calls = 0;
    let reply = { code: 0, stdout: JSON.stringify({ chapters: [{ start_time: 0, title: 'Auto 1' }, { start_time: 60, title: 'Auto 2' }] }) };
    const chapters = D.createChapters({ run: async (args) => { calls += 1; assert.ok(args.includes('--skip-download')); return reply; } });
    const a = await chapters('vid1', '0:00 a\n1:00 b\n2:00 c');
    assert.strictEqual(a.source, 'description');
    assert.strictEqual(calls, 0);
    const b = await chapters('vid2', 'no times here');
    assert.strictEqual(b.source, 'youtube');
    assert.strictEqual(b.chapters.length, 2);
    await chapters('vid2', 'no times here');
    assert.strictEqual(calls, 1, 'cached');
    reply = { code: 1, stdout: '', tail: 'not a bot' };
    const c = await chapters('vid3', '');
    assert.match(c.error, /bot/);
    await chapters('vid3', '');
    assert.strictEqual(calls, 3, 'an error is not cached');
  });

  console.log(`youtubeDownload tests passed (${passed})`);
})().catch((e) => { console.error(e); process.exit(1); });
