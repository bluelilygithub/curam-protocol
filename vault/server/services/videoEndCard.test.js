'use strict';

const assert = require('assert');
const { normalizeEndCard, layoutEndCard } = require('./videoEndCard');

assert.ok(normalizeEndCard({}).error, 'empty card rejected');
assert.ok(normalizeEndCard({ headline: '   ' }).error, 'blank text rejected');

const spec = normalizeEndCard({
  headline: 'Book today', buttonText: 'Call now', url: 'example.com',
  durationSec: '99', fadeSec: '50', bgColor: 'nope', buttonColor: '#ffffff',
});
assert.strictEqual(spec.durationSec, 15, 'duration clamped');
assert.strictEqual(spec.fadeSec, 7.5, 'fade capped at half the card');
assert.strictEqual(spec.bgColor, '111111', 'bad colour falls back');
assert.strictEqual(spec.buttonTextColor, '000000', 'dark label on light button');

const blocks = layoutEndCard(spec, 1080, 1920);
assert.deepStrictEqual(blocks.map((b) => b.kind), ['headline', 'button', 'url']);
for (let i = 1; i < blocks.length; i += 1) {
  assert.ok(blocks[i].y > blocks[i - 1].y, 'blocks stack top to bottom');
}
const last = blocks[blocks.length - 1];
assert.ok(blocks[0].y >= 0 && last.y + last.height <= 1920, 'stays inside the frame');

const long = layoutEndCard(normalizeEndCard({ headline: 'word '.repeat(20) }), 720, 1280);
assert.ok(long[0].text.includes('\n'), 'long headline wraps');

// ---- tint over the picture: strength and fade are the person's to set ----
const { overlayVideoGraph } = require('./videoEndCard');
assert.strictEqual(normalizeEndCard({ headline: 'Hi' }).dimPct, 60, 'default tint strength is unchanged');
assert.strictEqual(normalizeEndCard({ headline: 'Hi', dimPct: 0 }).dimPct, 0, '0 means no tint, not the default');
assert.strictEqual(normalizeEndCard({ headline: 'Hi', dimPct: '35' }).dimPct, 35);
assert.strictEqual(normalizeEndCard({ headline: 'Hi', dimPct: 500 }).dimPct, 100);
assert.strictEqual(normalizeEndCard({ headline: 'Hi', dimPct: 'lots' }).dimPct, 60, 'junk falls back');
// a closing screen still fades in over at most half its time; a message over the picture may fade over the whole time
assert.strictEqual(normalizeEndCard({ headline: 'Hi', durationSec: 8, fadeSec: 99, placement: 'after' }).fadeSec, 4);
assert.strictEqual(normalizeEndCard({ headline: 'Hi', durationSec: 8, fadeSec: 99, placement: 'over-end' }).fadeSec, 8);
assert.strictEqual(normalizeEndCard({ headline: 'Hi', durationSec: 8, fadeSec: 2, placement: 'over-end' }).fadeSec, 2);

const draws = ["drawtext=text='x'"];
const common = { w: 1280, h: 720, fps: 30, startAt: 26, bgColor: '112233', draws, enable: ":enable='gte(t,26.000)'" };
// smooth fade: a colour layer whose opacity ramps up from the moment the message starts
let g = overlayVideoGraph({ ...common, fadeSec: 3, dimPct: 60 });
assert.match(g, /color=c=0x112233:s=1280x720:r=30,format=rgba,colorchannelmixer=aa=0\.60/);
assert.match(g, /fade=t=in:st=26\.000:d=3\.000:alpha=1\[tint\]/, 'ramps over the chosen time, starting when the message starts');
assert.match(g, /\[base\]\[tint\]overlay=shortest=1,drawtext/);
assert.ok(g.endsWith('format=yuv420p[v]'));
// no fade: the tint switches on at once
g = overlayVideoGraph({ ...common, fadeSec: 0, dimPct: 60 });
assert.match(g, /drawbox=.*color=0x112233@0\.60:t=fill:enable='gte\(t,26\.000\)'/);
assert.ok(!g.includes('colorchannelmixer'));
// no tint: the picture keeps its colour, nothing is drawn over it but the text
g = overlayVideoGraph({ ...common, fadeSec: 3, dimPct: 0 });
assert.ok(!g.includes('drawbox') && !g.includes('colorchannelmixer') && !g.includes('overlay='), 'no tint layer at all');
assert.match(g, /^\[0:v\]scale=1280:720,setsar=1,fps=30,drawtext/);
// a held last frame is padded before the tint so the tint covers it
assert.match(overlayVideoGraph({ ...common, fadeSec: 1, dimPct: 50, pad: ',tpad=stop_mode=clone:stop_duration=4' }), /fps=30,tpad=stop_mode=clone:stop_duration=4\[base\]/);
// every graph ends in the [v] label the caller maps
for (const f of [3, 0]) for (const d of [0, 60]) assert.ok(overlayVideoGraph({ ...common, fadeSec: f, dimPct: d }).endsWith('[v]'));

// ---- titles are pieces of ONE graph (so the video is encoded once, not once per title) ----
const { titleStage, closingTiming } = require('./videoEndCard');
const stageDraws = ["drawtext=text='Title'"];
const base = { inLabel: '[held]', outLabel: '[v]', tintLabel: '[tintI]', w: 1280, h: 720, fps: 30, draws: stageDraws, enable: ":enable='lte(t,5.000)'", bgColor: '112233' };

// OPENING: tint fades OUT starting when the hold ends
let st = titleStage({ ...base, dimPct: 60, fadeSec: 2, fadeDir: 'out', fadeStart: 3, final: false });
assert.match(st, /^color=c=0x112233:s=1280x720:r=30,format=rgba,colorchannelmixer=aa=0\.60,fade=t=out:st=3\.000:d=2\.000:alpha=1\[tintI\];\[held\]\[tintI\]overlay=shortest=1,drawtext/);
assert.ok(st.endsWith('[v]') && !st.includes('format=yuv420p'), 'not the last piece: no pixel-format step yet');
assert.ok(!/fade=t=in/.test(st), 'the opening does not fade in: it is there from the first picture');

// CLOSING: tint fades IN starting when the message starts
st = titleStage({ ...base, tintLabel: '[tintE]', dimPct: 60, fadeSec: 3, fadeDir: 'in', fadeStart: 26, final: true });
assert.match(st, /fade=t=in:st=26\.000:d=3\.000:alpha=1\[tintE\];\[held\]\[tintE\]overlay=shortest=1,drawtext.*,format=yuv420p\[v\]$/);

// instant tint, and no tint at all
st = titleStage({ ...base, dimPct: 60, fadeSec: 0, fadeDir: 'in', fadeStart: 0, final: true });
assert.match(st, /^\[held\]drawbox=x=0:y=0:w=iw:h=ih:color=0x112233@0\.60:t=fill:enable='lte\(t,5\.000\)',drawtext.*format=yuv420p\[v\]$/);
st = titleStage({ ...base, dimPct: 0, fadeSec: 2, fadeDir: 'out', fadeStart: 3, final: true });
assert.ok(!/drawbox|colorchannelmixer|overlay=/.test(st), 'no tint: the picture keeps its colour');
assert.match(st, /^\[held\]drawtext/);

// the closing message occupies the last `durationSec` seconds and fades in from its start
let ct = closingTiming({ totalSec: 38, durationSec: 5, fadeSec: 2 });
assert.deepStrictEqual([ct.startAt, ct.fadeSec], [33, 2]);
assert.match(ct.enable, /gte\(t,33\.000\)/);
assert.match(ct.alphaExpr, /\(t-33\.000\)\/2\.000/);
assert.strictEqual(closingTiming({ totalSec: 38, durationSec: 5, fadeSec: 99 }).fadeSec, 5, 'a fade cannot outlast the message');
assert.strictEqual(closingTiming({ totalSec: 3, durationSec: 5, fadeSec: 1 }).startAt, 0, 'a message longer than the video starts at 0');
assert.strictEqual(closingTiming({ totalSec: 38, durationSec: 5, fadeSec: 0 }).alphaExpr, '');

// the timing the person asked for: a 3 s hold means 3 s FULLY visible, whatever the fade-away is set to
const { introTiming } = require('./videoEndCard');
let it = introTiming({ holdSec: 3, fadeSec: 2, videoSec: 60 });
assert.strictEqual(it.fadeSec, 2);
assert.strictEqual(it.lastVisible, 5, 'visible for 3 s held + 2 s fading');
assert.match(it.alphaExpr, /\(5\.000-t\)\/2\.000/, 'opacity is 1 until t = 3, then falls to 0 at t = 5');
// check the numbers the ffmpeg expression produces
const alphaAt = (t, tm) => Math.min(1, Math.max(0, (tm.lastVisible - t) / tm.fadeSec));
for (const t of [0, 1, 2, 3]) assert.strictEqual(alphaAt(t, it), 1, `fully visible at ${t}s`);
assert.strictEqual(alphaAt(4, it), 0.5);
assert.strictEqual(alphaAt(5, it), 0);
it = introTiming({ holdSec: 3, fadeSec: 0, videoSec: 60 });
assert.strictEqual(it.alphaExpr, '', 'no fade: no alpha expression, just on then off');
assert.match(it.enable, /lte\(t,3\.000\)/);
it = introTiming({ holdSec: 3, fadeSec: 10, videoSec: 5 });
assert.strictEqual(it.fadeSec, 2, 'the fade-away cannot outlast the video (5 s video: 2 s after the 3 s hold)');
assert.strictEqual(introTiming({ holdSec: 3, fadeSec: 1, videoSec: 0 }).fadeSec, 0, 'unknown length: no fade rather than a broken expression');

console.log('videoEndCard tests passed');
