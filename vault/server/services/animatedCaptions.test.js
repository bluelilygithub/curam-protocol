'use strict';

// node server/services/animatedCaptions.test.js
// Parts 1-2 need nothing. Part 3 makes a real video (needs Chromium from Playwright and ffmpeg; skipped with a note when ffmpeg is missing).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const svc = require('./animatedCaptions');
const { RenderCancelled } = require('./htmlVideoRender');

const ffmpeg = process.env.LOCAL_FFMPEG_COMMAND || 'ffmpeg';
const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 1 << 24, ...opts }, (e, o, se) => (e ? rej(Object.assign(e, { stderr: se })) : res(o))));

(async () => {
  // ---- 1. options and word timing ----
  const o = svc.normalizeOptions({ style: 'zoom', position: 'left', size: 'huge', text: 'red', highlight: '#FF00AA', box: 'yes', fontSource: 'arial', useBrandColours: 1 });
  assert.deepStrictEqual(o, { style: 'highlight', position: 'bottom', size: 'medium', text: '#ffffff', highlight: '#ff00aa', box: false, boxColor: '#000000', fontSource: 'standard', useBrandColours: false });
  assert.deepStrictEqual(svc.normalizeOptions(null).style, 'highlight');

  const cues = [{ startMs: 1000, endMs: 3000, text: 'Hello there, my friend.\nHow are you today?' }];
  const [w] = svc.wordTimings(cues);
  assert.deepStrictEqual(w.map((x) => x.text), ['Hello', 'there,', 'my', 'friend.', 'How', 'are', 'you', 'today?']);
  assert.strictEqual(w[0].startMs, 1000);
  assert.strictEqual(w[w.length - 1].endMs, 3000, 'the last word ends with the cue');
  for (let i = 1; i < w.length; i += 1) assert.strictEqual(w[i].startMs, w[i - 1].endMs, 'words follow each other with no gap');
  assert.ok(w[3].endMs - w[3].startMs > w[2].endMs - w[2].startMs, 'a longer word gets more time');

  const pages = svc.pagesOf(w);
  assert.deepStrictEqual(pages.map((p) => p.map((x) => x.text).join(' ')), ['Hello there,', 'my friend.', 'How are you today?'], 'pages stop after punctuation');
  assert.ok(svc.pagesOf(svc.wordTimings([{ startMs: 0, endMs: 6000, text: 'one two three four five six seven eight nine ten' }])[0]).every((p) => p.length <= 5), 'at most five words a page');
  assert.ok(svc.pagesOf(svc.wordTimings([{ startMs: 0, endMs: 6000, text: 'extraordinarily internationalisation incomprehensibilities' }])[0]).every((p) => p.length >= 1));

  // ---- 2. the timeline, the page and the picture list ----
  const tl = svc.buildTimeline([{ startMs: 500, endMs: 2500, text: 'Hello there, my friend.' }, { startMs: 4000, endMs: 5000, text: 'Bye now' }]);
  assert.strictEqual(tl.segments[0].page, -1, 'nothing on screen before the first word');
  assert.strictEqual(tl.segments[0].endMs, 500);
  const shown = tl.segments.filter((s) => s.page >= 0);
  assert.strictEqual(shown.length, 6, 'one picture for each word');
  for (let i = 1; i < tl.segments.length; i += 1) assert.ok(tl.segments[i].startMs >= tl.segments[i - 1].endMs, 'segments never overlap');
  assert.ok(tl.segments.some((s) => s.page === -1 && s.startMs === 2500 && s.endMs === 4000), 'a gap between the cues is an empty picture');
  assert.strictEqual(tl.segments[tl.segments.length - 1].endMs, 5000);
  // overlapping cues: the later page takes over
  const ov = svc.buildTimeline([{ startMs: 0, endMs: 3000, text: 'first cue here' }, { startMs: 1000, endMs: 2000, text: 'second' }]);
  for (let i = 1; i < ov.segments.length; i += 1) assert.ok(ov.segments[i].startMs >= ov.segments[i - 1].endMs);
  assert.deepStrictEqual(svc.buildTimeline([]).segments, []);

  const band = svc.bandSize(1920, 1080, 'medium');
  assert.deepStrictEqual([band.width, band.font], [1920, 70]);
  assert.ok(band.height % 2 === 0 && band.height < 1080 / 2 + 1);
  assert.strictEqual(svc.bandSize(1080, 1920, 'small').font, 54, 'the shorter side sets the size');
  const html = svc.buildHtml(svc.normalizeOptions({ style: 'pop', box: true }), band, { text: '#ffffff', highlight: '#ffd400', box: '#000000' }, [[{ text: '</script><b>x</b>' }]]);
  assert.ok(!html.includes('</script><b>'), 'a word cannot close the script');
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(!/https?:\/\//i.test(html), 'no web address in the page');
  const list = svc.concatList([{ startMs: 0, endMs: 500, page: -1 }, { startMs: 500, endMs: 1250, page: 0 }], ['a0.png', 'a1.png', 'a2.png'], 'blank.png');
  assert.strictEqual(list, "file 'blank.png'\nduration 0.500\nfile 'a1.png'\nduration 0.750\nfile 'a1.png'\n");
  assert.deepStrictEqual(['top', 'middle', 'bottom'].map(svc.overlayY), ['0', '(main_h-overlay_h)/2', 'main_h-overlay_h']);

  // ---- 3. a real video ----
  if (!(await run(ffmpeg, ['-version']).then(() => true, () => false))) {
    console.log('animatedCaptions tests: parts 1-2 ok; part 3 (real video) skipped, ffmpeg not found');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animcap-'));
  try {
    const src = path.join(dir, 'in.mp4');
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#335577:s=640x360:r=25:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
    const srt = '1\n00:00:00,500 --> 00:00:02,000\nHello there my friend\n\n2\n00:00:03,000 --> 00:00:03,800\nBye now\n';
    const work = path.join(dir, 'work'); fs.mkdirSync(work);
    const out = path.join(dir, 'out.mp4');
    const t0 = Date.now();
    const r = await svc.makeAnimatedCaptions({ videoPath: src, srt, options: svc.normalizeOptions({ style: 'highlight', size: 'large' }), outPath: out, workDir: work });
    assert.strictEqual(r.words, 6);
    assert.strictEqual(r.pictures, 8, '6 words and 2 gaps (before the first cue, between the cues)');
    console.log(`  made captions in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const probe = await run(ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')), ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-of', 'default=nw=1', out]);
    assert.match(probe, /width=640/); assert.match(probe, /height=360/); assert.match(probe, /codec_type=audio/, 'the sound is kept');
    const gray = (file, t) => run(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-vf', 'scale=160:90', '-'], { encoding: 'buffer' });
    const diff = async (t) => { const a = await gray(src, t); const b = await gray(out, t); let s = 0; for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]); return s / a.length; };
    const during = await diff(1.2);
    const gap = await diff(2.5);
    const before = await diff(0.2);
    // the re-encode alone moves the picture a little (about 1), a caption moves it a lot more
    assert.ok(during > 3 * Math.max(gap, before) && during > 3, `a word is on screen at 1.2 s (difference ${during.toFixed(2)}; gap ${gap.toFixed(2)}, before ${before.toFixed(2)})`);
    assert.ok(gap < 2 && before < 2, 'no caption in a gap or before the first word');

    // cancel in the middle of drawing
    const ac = new AbortController();
    const work2 = path.join(dir, 'work2'); fs.mkdirSync(work2);
    setTimeout(() => ac.abort(), 1500);
    await assert.rejects(() => svc.makeAnimatedCaptions({ videoPath: src, srt, options: svc.normalizeOptions({}), outPath: path.join(dir, 'x.mp4'), workDir: work2, signal: ac.signal }), (e) => e instanceof RenderCancelled || e.name === 'AbortError');
    await assert.rejects(() => svc.makeAnimatedCaptions({ videoPath: src, srt: 'no times here', options: svc.normalizeOptions({}), outPath: path.join(dir, 'y.mp4'), workDir: work }), (e) => e.status === 400 && /timings/.test(e.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('animatedCaptions tests: all ok');
})().catch((e) => { console.error(e); process.exit(1); });
