'use strict';
const assert = require('assert');
const { planReplaceSection, buildReplaceGraph, normalizeEdge, xfadeFor } = require('./replaceSection');

const plan = (o) => planReplaceSection({ origSec: 60, replSec: 12, startSec: 20, ...o });

// ---- the length rule: matching clip, within a tenth of a second ----
let p = plan({});
assert.deepStrictEqual([p.start, p.end, p.length], [20, 32, 12], 'the end follows from the clip length');
assert.strictEqual(p.adjustedBySec, 0);
// an explicit end that matches
p = plan({ endSec: 32 });
assert.strictEqual(p.length, 12);
// a tiny mismatch is fixed quietly, and reported
p = plan({ replSec: 12.06 });
assert.strictEqual(p.length, 12.06);
p = plan({ endSec: 32, replSec: 12.06 });
assert.strictEqual(p.length, 12);
assert.ok(Math.abs(p.adjustedBySec - 0.06) < 1e-9, 'the person is told how much was fixed');
// a bigger mismatch is refused with the exact trim
assert.throws(() => plan({ endSec: 32, replSec: 12.5 }), /Your clip is 0\.5 s too long for this section \(the section is 12\.0 s, the clip is 12\.5 s\)\. Trim 0\.5 s off the clip in Clip \/ trim/);
assert.throws(() => plan({ endSec: 32, replSec: 11.2 }), /Your clip is 0\.8 s too short for this section/);
assert.throws(() => plan({ endSec: 32, replSec: 11.2 }), /Use a clip that is 12\.0 s long/);

// ---- the section must sit inside the video ----
assert.throws(() => plan({ startSec: 55 }), /runs past the end of your video: it would finish at 67\.0 s but the video is only 60\.0 s long/);
assert.doesNotThrow(() => plan({ startSec: 48 }), 'a section that ends exactly at the end is fine');
assert.strictEqual(plan({ startSec: 48.05 }).end, 60, 'a hair past the end is clamped, not refused');
assert.throws(() => plan({ endSec: 20.1, replSec: 0.1 }), /too short/);
assert.throws(() => planReplaceSection({ origSec: 0, replSec: 5, startSec: 0 }), /how long your video is/);
assert.throws(() => planReplaceSection({ origSec: 60, replSec: 0, startSec: 0 }), /replacement clip is/);
assert.strictEqual(plan({ startSec: -5 }).start, 0, 'negative start is 0');

// ---- transitions live INSIDE the section, so its length never changes ----
p = plan({ transitionIn: { type: 'crossfade', sec: 1 }, transitionOut: { type: 'dip_black', sec: 2 } });
assert.deepStrictEqual([p.xfadeIn, p.xfadeOut, p.din, p.dout], ['fade', 'fadeblack', 1, 2]);
assert.strictEqual(p.length, 12, 'blends do not change the section length');
p = plan({ transitionIn: { type: 'dip_white', sec: 3 }, transitionOut: { type: 'wipe_left', sec: 3 } });
assert.deepStrictEqual([p.xfadeIn, p.xfadeOut], ['fadewhite', 'wipeleft']);
p = planReplaceSection({ origSec: 60, replSec: 2, startSec: 10, transitionIn: { type: 'crossfade', sec: 3 }, transitionOut: { type: 'crossfade', sec: 3 } });
assert.ok(p.din + p.dout <= 2 + 1e-9, 'together the blends never use more than the whole section');
assert.deepStrictEqual([p.xfadeIn, p.xfadeOut].map(Boolean), [true, true]);
p = plan({});
assert.deepStrictEqual([p.xfadeIn, p.xfadeOut, p.din, p.dout], [null, null, 0, 0], 'no transition = hard cuts');
assert.strictEqual(normalizeEdge({ type: 'crossfade', sec: 99 }).sec, 3, 'at most 3 s');
assert.strictEqual(normalizeEdge({ type: 'crossfade', sec: 0 }).sec, 0.1);
assert.strictEqual(normalizeEdge({ type: 'nonsense' }).type, 'cut');
assert.strictEqual(xfadeFor('slide_right'), 'slideright');
assert.strictEqual(xfadeFor('cut'), null);

// ---- the picture graph: frame-exact, so the untouched soundtrack stays in step ----
const common = { width: 1280, height: 720, fps: 30, fit: 'fill' };
const frames = (g) => g.frames;
let r = buildReplaceGraph(plan({}), common); // 20s..32s of a 60s video, hard cuts
assert.deepStrictEqual(frames(r), { before: 600, blendIn: 0, middle: 360, blendOut: 0, section: 360, total: 1800 });
assert.match(r.graph, /\[o_before\]trim=start_frame=0:end_frame=600/);
assert.match(r.graph, /\[o_after\]trim=start_frame=960,setpts=PTS-STARTPTS\[C\]/);
assert.match(r.graph, /\[A\]\[MID\]\[C\]concat=n=3:v=1:a=0\[v\]$/);
assert.ok(!r.graph.includes('xfade'), 'hard cuts need no blend');
assert.match(r.graph, /scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720/, 'fill the frame by default');
assert.match(r.graph, /tpad=stop_mode=clone:stop_duration=0\.5,trim=start_frame=0:end_frame=360/, 'a clip a hair short is held, then cut to the exact length');
// the frame counts add up to the original, so picture and sound stay in sync
const total = (f) => f.before + f.section + (f.total - f.before - f.section);
assert.strictEqual(total(r.frames), 1800);

// with both transitions
r = buildReplaceGraph(plan({ transitionIn: { type: 'crossfade', sec: 1 }, transitionOut: { type: 'dip_black', sec: 0.5 } }), common);
assert.deepStrictEqual(frames(r), { before: 600, blendIn: 30, middle: 315, blendOut: 15, section: 360, total: 1800 });
assert.strictEqual(r.frames.blendIn + r.frames.middle + r.frames.blendOut, r.frames.section, 'blends + new clip = the section exactly');
assert.match(r.graph, /\[BI\]\[RI\]xfade=transition=fade:duration=1\.000000:offset=0\[IN\]/);
assert.match(r.graph, /\[RO\]\[BO\]xfade=transition=fadeblack:duration=0\.500000:offset=0\[OUT\]/);
assert.match(r.graph, /\[o_bIn\]trim=start_frame=600:end_frame=630/, 'the blend-in uses the ORIGINAL picture at the start of the section');
assert.match(r.graph, /\[o_bOut\]trim=start_frame=945:end_frame=960/, 'the blend-out uses the ORIGINAL picture at the end of the section');
assert.match(r.graph, /\[A\]\[IN\]\[MID\]\[OUT\]\[C\]concat=n=5:v=1:a=0\[v\]$/);
// both ends of the new clip are in the right order: in at its start, out at its end
assert.match(r.graph, /\[r_in\]trim=start_frame=0:end_frame=30/);
assert.match(r.graph, /\[r_out\]trim=start_frame=345:end_frame=360/);

// the section at the very start, and at the very end: no empty pieces for ffmpeg to choke on
r = buildReplaceGraph(planReplaceSection({ origSec: 60, replSec: 10, startSec: 0 }), common);
assert.ok(!r.graph.includes('[A]') && !r.graph.includes('o_before'), 'nothing before the section');
assert.match(r.graph, /\[MID\]\[C\]concat=n=2/);
r = buildReplaceGraph(planReplaceSection({ origSec: 60, replSec: 10, startSec: 50 }), common);
assert.ok(!r.graph.includes('[C]') && !r.graph.includes('o_after'), 'nothing after the section');
assert.match(r.graph, /\[A\]\[MID\]concat=n=2/);
// the whole video replaced: a single piece, no concat
r = buildReplaceGraph(planReplaceSection({ origSec: 10, replSec: 10, startSec: 0 }), common);
assert.match(r.graph, /\[MID\]null\[v\]$/);
assert.ok(!r.graph.includes('[0:v]'), 'the original picture is not even read');

// fit with bars, odd sizes made even
r = buildReplaceGraph(plan({}), { width: 1281, height: 721, fps: 25, fit: 'fit' });
assert.match(r.graph, /scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:\(ow-iw\)\/2:\(oh-ih\)\/2:color=black/);
assert.match(r.graph, /fps=25/);

// every graph ends in [v], and every label it reads was written by an earlier piece
for (const g of [
  buildReplaceGraph(plan({ transitionIn: { type: 'slide_left', sec: 0.4 } }), common).graph,
  buildReplaceGraph(plan({ transitionOut: { type: 'wipe_up', sec: 0.4 } }), common).graph,
  buildReplaceGraph(plan({}), common).graph,
]) {
  assert.ok(g.endsWith('[v]'));
  const written = new Set(['0:v', '1:v']);
  for (const piece of g.split(';')) {
    const reads = [...piece.matchAll(/^((?:\[[^\]]+\])+)/g)].flatMap((m) => [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]));
    const writes = [...piece.matchAll(/\[([^\]]+)\]$/g)].flatMap((m) => [m[1]]);
    const outs = [...piece.replace(/^((?:\[[^\]]+\])+)/, '').matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]);
    reads.forEach((l) => assert.ok(written.has(l), `reads ${l} before it is written in: ${piece}`));
    outs.forEach((l) => written.add(l));
    writes.forEach((l) => written.add(l));
  }
}

console.log('replaceSection tests passed');
