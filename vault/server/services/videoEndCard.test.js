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

console.log('videoEndCard tests passed');
