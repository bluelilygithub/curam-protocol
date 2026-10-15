'use strict';
const assert = require('assert');
const { planTitleCard, buildTitleCardGraph } = require('./titleCard');
const { windowTiming, windowTitleStage, normalizeEndCard } = require('./videoEndCard');

// ---- the window the card is on screen ----
let p = planTitleCard({ videoSec: 60, startSec: 10, endSec: 15 });
assert.deepStrictEqual([p.start, p.end, p.clampedToEnd], [10, 15, false]);
p = planTitleCard({ videoSec: 60, startSec: 55, endSec: 90 });
assert.deepStrictEqual([p.start, p.end, p.clampedToEnd], [55, 60, true], 'an end past the video is held at the end of the video');
assert.throws(() => planTitleCard({ videoSec: 60, startSec: 61, endSec: 70 }), /starts at 61\.0 s, but your video is only 60\.0 s long/);
assert.throws(() => planTitleCard({ videoSec: 60, startSec: 10, endSec: 10.2 }), /at least 0\.5 seconds/);
assert.throws(() => planTitleCard({ videoSec: 60, startSec: 10 }), /Set when the card ends/);
assert.throws(() => planTitleCard({ videoSec: 0, startSec: 0, endSec: 5 }), /how long your video is/);
assert.strictEqual(planTitleCard({ videoSec: 60, startSec: -4, endSec: 5 }).start, 0);

// ---- the fade-out length is the person's, and defaults to the fade-in length ----
assert.strictEqual(normalizeEndCard({ headline: 'Hi' }).fadeOutSec, 0.5);
assert.strictEqual(normalizeEndCard({ headline: 'Hi', fadeSec: 2 }).fadeOutSec, 2, 'same as fade-in unless set');
assert.strictEqual(normalizeEndCard({ headline: 'Hi', fadeSec: 2, fadeOutSec: 0 }).fadeOutSec, 0, '0 means no fade out, not "use the default"');
assert.strictEqual(normalizeEndCard({ headline: 'Hi', fadeOutSec: 99 }).fadeOutSec, 15);
assert.strictEqual(normalizeEndCard({ headline: 'Hi', fadeOutSec: 'lots' }).fadeOutSec, 0.5);

// ---- visibility timing: fades in from the start, out to the end, and never use more than the whole time ----
let t = windowTiming({ startSec: 10, endSec: 20, fadeInSec: 1, fadeOutSec: 2 });
assert.deepStrictEqual([t.start, t.end, t.fadeIn, t.fadeOut], [10, 20, 1, 2]);
assert.match(t.enable, /between\(t,10\.000,20\.000\)/);
const alphaAt = (time, tm) => {
  const ramps = [];
  if (tm.fadeIn > 0) ramps.push((time - tm.start) / tm.fadeIn);
  if (tm.fadeOut > 0) ramps.push((tm.end - time) / tm.fadeOut);
  return ramps.length ? Math.min(1, Math.max(0, Math.min(...ramps))) : 1;
};
assert.strictEqual(alphaAt(10, t), 0, 'invisible at the first moment');
assert.strictEqual(alphaAt(10.5, t), 0.5);
assert.strictEqual(alphaAt(11, t), 1, 'fully there after the fade-in');
assert.strictEqual(alphaAt(15, t), 1, 'fully there in the middle');
assert.strictEqual(alphaAt(19, t), 0.5, 'halfway out with a second of the 2 s fade-out to go');
assert.strictEqual(alphaAt(20, t), 0);
assert.match(t.alphaExpr, /^:alpha='min\(1,max\(0,min\(\(t-10\.000\)\/1\.000,\(20\.000-t\)\/2\.000\)\)\)'$/);
t = windowTiming({ startSec: 10, endSec: 20, fadeInSec: 0, fadeOutSec: 0 });
assert.strictEqual(t.alphaExpr, '', 'no fades: on at the start, off at the end');
t = windowTiming({ startSec: 10, endSec: 20, fadeInSec: 1, fadeOutSec: 0 });
assert.match(t.alphaExpr, /^:alpha='min\(1,max\(0,\(t-10\.000\)\/1\.000\)\)'$/);
t = windowTiming({ startSec: 10, endSec: 12, fadeInSec: 5, fadeOutSec: 5 });
assert.ok(t.fadeIn + t.fadeOut <= 2 + 1e-9, 'fades never use more than the whole time');
assert.ok(windowTiming({ startSec: 5, endSec: 5, fadeInSec: 0, fadeOutSec: 0 }).end >= 5.3, 'a zero-length window gets a minimum');

// ---- the picture graph ----
const draws = ["drawtext=text='Title'"];
const base = { inLabel: '[base]', outLabel: '[v]', tintLabel: '[tint]', w: 1280, h: 720, fps: 30, draws, bgColor: '112233' };
const both = windowTiming({ startSec: 10, endSec: 20, fadeInSec: 1, fadeOutSec: 2 });
let g = windowTitleStage({ ...base, dimPct: 60, timing: both, final: false });
assert.match(g, /^color=c=0x112233:s=1280x720:r=30,format=rgba,colorchannelmixer=aa=0\.60,fade=t=in:st=10\.000:d=1\.000:alpha=1,fade=t=out:st=18\.000:d=2\.000:alpha=1\[tint\];/);
assert.match(g, /\[base\]\[tint\]overlay=shortest=1:enable='between\(t,10\.000,20\.000\)',drawtext.*\[v\]$/, 'the tint is switched off outside the window, so it cannot show before the card starts');
// only a fade in
g = windowTitleStage({ ...base, dimPct: 60, timing: windowTiming({ startSec: 10, endSec: 20, fadeInSec: 1, fadeOutSec: 0 }), final: false });
assert.ok(g.includes('fade=t=in') && !g.includes('fade=t=out'));
// no fades: instant tint
g = windowTitleStage({ ...base, dimPct: 60, timing: windowTiming({ startSec: 10, endSec: 20, fadeInSec: 0, fadeOutSec: 0 }), final: true });
assert.match(g, /^\[base\]drawbox=x=0:y=0:w=iw:h=ih:color=0x112233@0\.60:t=fill:enable='between\(t,10\.000,20\.000\)',drawtext.*format=yuv420p\[v\]$/);
// no tint: the picture keeps its colour
g = windowTitleStage({ ...base, dimPct: 0, timing: both, final: true });
assert.ok(!/drawbox|colorchannelmixer|overlay=/.test(g));
assert.match(g, /^\[base\]drawtext/);

// the whole graph reads the video, ends in [v], and fixes an odd picture size first
const prepared = { w: 1280, h: 720, fps: 30, draws, dimPct: 60, bgColor: '112233', timing: both };
let full = buildTitleCardGraph({ prepared });
assert.match(full, /^\[0:v\]format=yuv420p\[base\];color=/);
assert.ok(full.endsWith('[v]'));
assert.match(buildTitleCardGraph({ prepared, scale: { w: 1280, h: 718 } }), /^\[0:v\]scale=1280:718,setsar=1,format=yuv420p\[base\];/);
// the graph makes exactly one video output and never changes the video's length: no trim, no tpad, no concat
assert.ok(!/trim|tpad|concat|setpts/.test(full), 'the card sits over the playing picture; nothing is cut or held');

console.log('titleCard tests passed');
