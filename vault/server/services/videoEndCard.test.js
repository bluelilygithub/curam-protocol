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

// ---- OPENING title: there from the very first frame, fully visible for the whole hold, then fading away as the video moves ----
const { introOverlayGraph } = require('./videoEndCard');
const idraws = ["drawtext=text='Title'"];
const icommon = { w: 1280, h: 720, fps: 30, holdSec: 4, bgColor: '112233', draws: idraws, enable: ":enable='lte(t,4.000)'" };
let ig = introOverlayGraph({ ...icommon, fadeSec: 1, dimPct: 60 });
assert.match(ig, /color=c=0x112233:s=1280x720:r=30,format=rgba,colorchannelmixer=aa=0\.60/);
assert.match(ig, /fade=t=out:st=4\.000:d=1\.000:alpha=1\[tint\]/, 'the tint starts fading only AFTER the whole 4 s hold, so the title is fully visible for the full hold');
assert.ok(!/fade=t=in/.test(ig), 'it does not fade in: the title is there from the first frame');
assert.match(ig, /\[base\]\[tint\]overlay=shortest=1,drawtext/);
ig = introOverlayGraph({ ...icommon, fadeSec: 0, dimPct: 60 });
assert.match(ig, /drawbox=.*color=0x112233@0\.60:t=fill:enable='lte\(t,4\.000\)'/, 'no fade: tint and title stay until the hold ends, then go at once');
ig = introOverlayGraph({ ...icommon, fadeSec: 1, dimPct: 0 });
assert.ok(!/drawbox|colorchannelmixer|overlay=/.test(ig), 'no tint: the first picture keeps its colour');
assert.match(ig, /^\[0:v\]scale=1280:720,setsar=1,fps=30,drawtext/);
for (const f of [1, 0]) for (const d of [0, 60]) assert.ok(introOverlayGraph({ ...icommon, fadeSec: f, dimPct: d }).endsWith('[v]'));

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
