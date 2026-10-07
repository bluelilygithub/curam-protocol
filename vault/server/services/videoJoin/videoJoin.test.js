'use strict';

// node server/services/videoJoin/videoJoin.test.js
//
// Part 1 (pure, always runs): validation, filter-graph structure, planner prompt, and the AI
// planner's handling of example instructions (the model is stubbed, so this checks how the plan
// is read and validated, not what a real model would say).
// Part 2 (needs ffmpeg + ffprobe on PATH, or LOCAL_FFMPEG_COMMAND / LOCAL_FFPROBE_COMMAND):
// real renders — dip brightness, "all cuts equals the current join", and effects-with-cuts going
// through the prepare stage. Part 2 is skipped, loudly, when ffmpeg is not available.

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// The planner modules import db.js, which would try to reach Postgres (and exit the process while
// the slower render tests are still running). Nothing here touches the database, so stub it first.
const dbPath = require.resolve('../../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async () => ({ rows: [] }) } } };

const { normalizeJoin, TRANSITIONS, curveValue, dipColourHex } = require('./transitions');
const { normalizeClipEffects, hasClipEffects, CLIP_EFFECTS, buildClipChain } = require('./clipEffects');
const { buildJoinGraph, planTimings } = require('./joinGraph');
const { joinClips } = require('./joinClips');
const { normalizeJoinPlan, buildJoinPrompt, planJoin } = require('../videoJoinPlan');
const ff = require('../videoFfmpeg');

let passed = 0;
let skipped = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// A stand-in for the model: returns whatever JSON the "model" would have said.
function stubModel(json) {
  return {
    callModel: async () => ({ text: JSON.stringify(json), model: 'stub', inputTokens: 0, outputTokens: 0 }),
    getModelsForUser: async () => ({ light: 'stub' }),
    logUsage: () => {},
  };
}
const threeClips = [{ name: 'intro.mp4' }, { name: 'middle.mp4' }, { name: 'outro.mp4' }];

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; reject(err); } else resolve({ stdout, stderr });
    });
  });
}

(async () => {
  // ------------------------------------------------------------------ validation
  await test('clip effects: clamps, drops unknown keys and defaults, ignores hostile values', () => {
    const fx = normalizeClipEffects({
      brightness: 99, contrast: 'abc', saturation: 0, speed: 100, volume: '0.5',
      look: 'bw; drawtext=x', mute: 'true', fadeIn: -3, trimStart: 2, trimEnd: 1, nonsense: 1,
    });
    assert.strictEqual(fx.brightness, 0.5);
    assert.ok(!('contrast' in fx));
    assert.strictEqual(fx.saturation, 0);
    assert.strictEqual(fx.speed, 4);
    assert.strictEqual(fx.volume, 0.5);
    assert.ok(!('look' in fx), 'unknown look must not pass through');
    assert.strictEqual(fx.mute, true);
    assert.ok(!('fadeIn' in fx), 'clamped to 0 = default = omitted');
    assert.strictEqual(fx.trimStart, 2);
    assert.ok(!('trimEnd' in fx), 'end before start means "to the end"');
    assert.ok(!('nonsense' in fx));
    assert.deepStrictEqual(normalizeClipEffects(null), {});
    assert.ok(!hasClipEffects({}));
    assert.ok(hasClipEffects({ look: 'bw' }));
  });

  await test('clip effects build the expected filters, in order', () => {
    const c = buildClipChain({ trimStart: 1, speed: 2, brightness: 0.1, look: 'bw', fadeOut: 0.5, volume: 0.5 }, 10);
    assert.deepStrictEqual(c.v.slice(0, 3), ['trim=start=1:end=10', 'setpts=PTS-STARTPTS', 'setpts=PTS/2']);
    assert.ok(c.v.some((x) => x.startsWith('eq=brightness=0.1')));
    assert.ok(c.v.some((x) => x.includes('hue=s=0')), 'bw reuses the slideshow MOOD_FILTERS mono grade');
    assert.strictEqual(c.dur, 4.5);
    assert.ok(c.v.includes('fade=t=out:st=4:d=0.5'), 'fade-out is placed after trim and speed');
    assert.ok(c.a.includes('volume=0.5'));
  });

  await test('joins: aliases, defaults, dip shorthand, hostile types', () => {
    assert.strictEqual(normalizeJoin({ type: 'fade_to_black' }).type, 'dip_black');
    assert.strictEqual(normalizeJoin({ type: 'fade' }).type, 'crossfade');
    assert.strictEqual(normalizeJoin({ type: 'wipeleft' }).type, 'wipe_left');
    assert.strictEqual(normalizeJoin({ type: 'drawtext=evil' }).type, 'cut');
    assert.strictEqual(normalizeJoin({ type: 'drawtext=evil' }, 'crossfade').type, 'crossfade');
    const black = normalizeJoin({ type: 'dip_black', duration: 1.2, hold: 0.5 });
    assert.deepStrictEqual(black, { type: 'dip_black', fadeOut: 1.2, hold: 0.5, fadeIn: 1.2, level: 0, curve: 'linear' });
    assert.strictEqual(normalizeJoin({ type: 'dip_white' }).level, 100, 'white defaults to full white');
    assert.strictEqual(normalizeJoin({ type: 'dip_black', level: 500, curve: 'nope', hold: 99 }).level, 100);
    assert.strictEqual(normalizeJoin({ type: 'dip_black', curve: 'nope', hold: 99 }).curve, 'linear');
    assert.strictEqual(normalizeJoin({ type: 'dip_black', hold: 99 }).hold, 3);
    assert.deepStrictEqual(normalizeJoin({ type: 'cut' }), { type: 'cut' });
  });

  await test('curves: endpoints are exact, ease_in is slow first, ease_out is slow last', () => {
    for (const c of ['linear', 'ease_in', 'ease_out', 's_curve']) {
      assert.strictEqual(curveValue(c, 0), 0);
      assert.strictEqual(curveValue(c, 1), 1);
    }
    assert.ok(curveValue('ease_in', 0.5) < 0.5);
    assert.ok(curveValue('ease_out', 0.5) > 0.5);
    assert.strictEqual(curveValue('s_curve', 0.5), 0.5);
  });

  await test('dip colour is one solid grey: level 0 black, 5 very dark, 100 white', () => {
    assert.strictEqual(dipColourHex(0), '0x000000');
    assert.strictEqual(dipColourHex(5), '0x0d0d0d');
    assert.strictEqual(dipColourHex(100), '0xffffff');
  });

  // ------------------------------------------------------------------ graph structure
  await test('timings: transitions never use more than 90% of a clip', () => {
    const js = planTimings([4, 1, 4], [
      { type: 'crossfade', duration: 3 },
      { type: 'dip_black', fadeOut: 3, hold: 0, fadeIn: 3, level: 0, curve: 'linear' },
    ]);
    // clip 1 (1 s long) has the first crossfade at its head and the dip fade-out at its tail
    assert.ok(js[0].duration + js[1].fadeOut <= 0.9 + 1e-9);
    assert.ok(js[0].duration <= 0.45 * 1 + 1e-9);
  });

  await test('graph: dip fades BOTH sides toward the same solid colour; blend uses xfade offsets', () => {
    const g = buildJoinGraph({
      durations: [3, 3, 3],
      width: 640,
      height: 360,
      joins: [
        { type: 'dip_black', fadeOut: 0.5, hold: 0.5, fadeIn: 0.5, level: 5, curve: 's_curve' },
        { type: 'crossfade', duration: 0.6 },
      ],
    });
    const colours = g.filterComplex.match(/color=c=0x0d0d0d/g) || [];
    assert.strictEqual(colours.length, 3, 'outgoing fade, incoming fade and hold all use the one colour');
    assert.ok(!/(^|[^a])fade=t=/.test(g.filterComplex), 'dip is a blend toward a colour, not a plain video fade');
    assert.ok(g.filterComplex.includes('xfade=transition=fade:duration=0.600:offset=5.900'));
    assert.ok(g.filterComplex.includes('afade=t=out'));
    assert.ok(g.filterComplex.includes('acrossfade=d=0.600'));
    assert.ok(Math.abs(g.totalDuration - 8.9) < 1e-9);
  });

  await test('graph: a middle cut mixes with a blend (no transition kind is special-cased by name)', () => {
    const g = buildJoinGraph({
      durations: [2, 2, 2], width: 320, height: 240,
      joins: [{ type: 'cut' }, { type: 'slide_left', duration: 0.5 }],
    });
    assert.ok(g.filterComplex.includes('concat=n=2'));
    assert.ok(g.filterComplex.includes('xfade=transition=slideleft'));
  });

  // ------------------------------------------------------------------ planner
  await test('planner prompt lists every registered transition, effect and parameter (generated)', () => {
    const prompt = buildJoinPrompt('anything', threeClips);
    for (const [id, def] of Object.entries(TRANSITIONS)) {
      if (def.hidden) assert.ok(!prompt.includes(`- ${id}:`), `${id} is hidden from the planner`);
      else {
        assert.ok(prompt.includes(`- ${id}:`), `${id} missing from prompt`);
        for (const key of Object.keys(def.params)) assert.ok(prompt.includes(key), `${id}.${key} missing`);
      }
    }
    for (const effect of CLIP_EFFECTS) {
      for (const key of Object.keys(effect.params)) assert.ok(prompt.includes(key), `${effect.id}.${key} missing`);
    }
    assert.ok(prompt.includes('Clip 1 (index 0): intro.mp4'));
  });

  await test('a newly registered effect is offered to the planner and validated, with no other edits', () => {
    CLIP_EFFECTS.push({
      id: 'blur-test',
      order: 45,
      description: 'Blur the clip.',
      params: { blurAmount: { type: 'number', min: 0, max: 20, default: 0, description: 'blur radius' } },
      build: (p) => (p.blurAmount ? { v: [`gblur=sigma=${p.blurAmount}`] } : null),
    });
    try {
      assert.ok(buildJoinPrompt('x', threeClips).includes('blurAmount'));
      assert.deepStrictEqual(normalizeClipEffects({ blurAmount: 50 }), { blurAmount: 20 });
      assert.ok(buildClipChain({ blurAmount: 5 }, 4).v.includes('gblur=sigma=5'));
      const plan = normalizeJoinPlan({ clips: [{ clip: 1, blurAmount: 3 }] }, 3);
      assert.strictEqual(plan.clips[1].blurAmount, 3);
    } finally {
      CLIP_EFFECTS.pop();
    }
  });

  await test('instruction: "fade to dark between clips 1 and 2, hold for half a second, then make the last clip black and white"', async () => {
    const plan = await planJoin('u', {
      description: 'fade to dark between clips 1 and 2, hold for half a second, then make the last clip black and white',
      clips: threeClips,
    }, stubModel({
      summary: 'Dip to black between the first two clips, last clip in black and white.',
      order: [0, 1, 2],
      transition: 'cut',
      joins: [{ after: 0, type: 'dip_black', hold: 0.5 }],
      clips: [{ clip: 2, look: 'bw' }],
    }));
    assert.deepStrictEqual(plan.order, [0, 1, 2]);
    assert.strictEqual(plan.joins.length, 2);
    assert.deepStrictEqual(
      { ...plan.joins[0] },
      { after: 0, type: 'dip_black', fadeOut: 0.5, hold: 0.5, fadeIn: 0.5, level: 0, curve: 'linear' },
    );
    assert.strictEqual(plan.joins[1].type, 'cut', 'joins nobody mentioned stay hard cuts');
    assert.deepStrictEqual(plan.clips, [{}, {}, { look: 'bw' }]);
  });

  await test('instruction: slow clip 2 to half speed, mute clip 1, slide left 0.4s between 2 and 3, drop 2s from the start of clip 3, brighten and add contrast to clip 2', async () => {
    const plan = await planJoin('u', { description: 'multi', clips: threeClips }, stubModel({
      order: [0, 1, 2],
      transition: 'cut',
      joins: [{ after: 1, type: 'slide_left', duration: 0.4 }],
      clips: [
        { clip: 0, mute: true },
        { clip: 1, speed: 0.5, brightness: 0.15, contrast: 1.3 },
        { clip: 2, trimStart: 2 },
      ],
    }));
    assert.strictEqual(plan.joins[0].type, 'cut');
    assert.deepStrictEqual({ ...plan.joins[1] }, { after: 1, type: 'slide_left', duration: 0.4 });
    assert.deepStrictEqual(plan.clips[0], { mute: true });
    assert.deepStrictEqual(plan.clips[1], { speed: 0.5, brightness: 0.15, contrast: 1.3 });
    assert.deepStrictEqual(plan.clips[2], { trimStart: 2 });
  });

  await test('instruction: dip to white with an off-white level, ease-in curve, fades at clip ends', async () => {
    const plan = await planJoin('u', { description: 'flash to white', clips: threeClips }, stubModel({
      order: [0, 1, 2],
      transition: 'dip_white',
      transitionSec: 0.8,
      joins: [{ after: 1, type: 'cut' }],
      clips: [{ clip: 0, fadeIn: 1 }, { clip: 2, fadeOut: 1.5 }],
    }));
    assert.deepStrictEqual(
      { ...plan.joins[0] },
      { after: 0, type: 'dip_white', fadeOut: 0.8, hold: 0, fadeIn: 0.8, level: 100, curve: 'linear' },
    );
    assert.strictEqual(plan.joins[1].type, 'cut');
    assert.deepStrictEqual(plan.clips, [{ fadeIn: 1 }, {}, { fadeOut: 1.5 }]);
  });

  await test('"after" follows the clip, not the position, when the planner reorders clips', async () => {
    const plan = await planJoin('u', { description: 'reverse, then dip after clip 1', clips: threeClips }, stubModel({
      order: [2, 1, 0],
      joins: [{ after: 0, type: 'dip_black' }], // clip index 0 plays last, so there is no join after it
    }));
    assert.deepStrictEqual(plan.order, [2, 1, 0]);
    assert.ok(plan.joins.every((j) => j.type === 'cut'), 'a join after the final clip is dropped');
    const p2 = normalizeJoinPlan({ order: [2, 1, 0], joins: [{ after: 1, type: 'dip_black' }] }, 3);
    assert.strictEqual(p2.joins[0].type, 'cut');
    assert.strictEqual(p2.joins[1].type, 'dip_black');
    assert.strictEqual(p2.joins[1].after, 1);
  });

  await test('hostile planner output is validated by the same allow-lists and clamps', async () => {
    const plan = await planJoin('u', { description: 'x', clips: threeClips }, stubModel({
      order: [0, 0, 9, 1],
      transition: "fade'; rm -rf /",
      joins: [
        { after: 0, type: 'dip_black;movie=/etc/passwd', fadeOut: 9999, hold: -5, level: 'zzz', curve: "x'y" },
        { after: 99, type: 'crossfade' },
        'not an object',
      ],
      clips: [
        { clip: 0, look: '../../x', brightness: 1e9, speed: 0, volume: -3, extra: 'drawtext=evil' },
        { clip: -1, mute: true },
        { clip: 7, mute: true },
      ],
    }));
    assert.deepStrictEqual(plan.order, [0, 1, 2]);
    assert.strictEqual(plan.transition, 'cut');
    assert.strictEqual(plan.joins[0].type, 'cut', 'unknown join type falls back to the default');
    // brightness clamps to its max, speed 0 to its min, volume -3 to its min (0 = silent); look and `extra` are dropped
    assert.deepStrictEqual(plan.clips[0], { brightness: 0.5, speed: 0.25, volume: 0 });
    assert.deepStrictEqual(plan.clips[1], {});
    assert.deepStrictEqual(plan.clips[2], {});
    const json = JSON.stringify(plan);
    assert.ok(!/drawtext|passwd|rm -rf/.test(json), 'no raw model text survives into the plan');
  });

  await test('original single-transition plans still validate exactly as before', () => {
    const plan = normalizeJoinPlan({ order: [1, 0], transition: 'fade', transitionSec: 0.8, summary: 's' }, 2);
    assert.deepStrictEqual(plan.order, [1, 0]);
    assert.strictEqual(plan.transition, 'fade');
    assert.strictEqual(plan.transitionSec, 0.8);
    assert.deepStrictEqual({ ...plan.joins[0] }, { after: 1, type: 'crossfade', duration: 0.8 });
    const cut = normalizeJoinPlan({ transition: 'cut', transitionSec: 5 }, 2);
    assert.strictEqual(cut.transitionSec, 0);
    assert.strictEqual(cut.joins[0].type, 'cut');
  });

  // ------------------------------------------------------------------ real renders
  const haveFfmpeg = await ff.checkFfmpeg();
  if (!haveFfmpeg) {
    skipped = 6;
    console.log('SKIP - ffmpeg not available: the dip-brightness, all-cut equality, prepare-stage and reorder renders did NOT run');
  } else {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vjtest-'));
    try {
      const ffmpeg = ff.FFMPEG;
      // Source clips with very different brightness, sizes and frame rates, all with audio.
      const make = async (name, colour, size, rate, tone) => {
        await run(ffmpeg, [
          '-v', 'error', '-y',
          '-f', 'lavfi', '-i', `color=c=${colour}:s=${size}:r=${rate}:d=3`,
          '-f', 'lavfi', '-i', `sine=f=${tone}:d=3`,
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, name),
        ]);
        return path.join(dir, name);
      };
      const light = await make('light.mp4', '0xE8E8E8', '640x360', 25, 440);
      const mid = await make('mid.mp4', '0x808080', '320x240', 24, 660);
      const dark = await make('dark.mp4', '0x181818', '640x360', 30, 880);
      const colourful = [
        await make('red.mp4', '0xC02828', '640x360', 30, 300),
        await make('green.mp4', '0x28A028', '640x360', 30, 500),
        await make('blue.mp4', '0x2838C0', '640x360', 30, 700),
      ];

      // Per-frame average luma/chroma via signalstats; written to a file so no path escaping is needed.
      async function stats(file) {
        const name = `stats-${path.basename(file)}.txt`;
        await run(ffmpeg, ['-v', 'error', '-y', '-i', file, '-vf', `signalstats,metadata=print:file=${name}`, '-an', '-f', 'null', '-'], dir);
        const text = await fs.readFile(path.join(dir, name), 'utf8');
        const frames = [];
        let cur = null;
        for (const line of text.split(/\r?\n/)) {
          const t = line.match(/pts_time:([\d.]+)/);
          if (t) { cur = { t: Number(t[1]) }; frames.push(cur); continue; }
          const m = line.match(/lavfi\.signalstats\.(YAVG|UAVG|VAVG)=([\d.]+)/);
          if (m && cur) cur[m[1]] = Number(m[2]);
        }
        return frames;
      }
      const at = (frames, t) => frames.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best), frames[0]);
      async function referenceY(hex) {
        const file = path.join(dir, `ref-${hex}.mp4`);
        await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${hex}:s=640x360:r=30:d=1,format=yuv420p`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
        return at(await stats(file), 0.5).YAVG;
      }
      const framemd5 = async (file) => (await run(ffmpeg, ['-v', 'error', '-i', file, '-f', 'framemd5', '-'])).stdout
        .split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').slice(-2).join(',')).join('\n');

      await test('dip to black between three clips of very different brightness: both sides meet at exactly the dip level', async () => {
        const out = path.join(dir, 'dip.mp4');
        const joins = [
          normalizeJoin({ type: 'dip_black', fadeOut: 0.5, hold: 0.5, fadeIn: 0.5, level: 5 }),
          normalizeJoin({ type: 'dip_black', fadeOut: 0.5, hold: 0.5, fadeIn: 0.5, level: 5, curve: 's_curve' }),
        ];
        const r = await joinClips([light, mid, dark], out, { clips: [{}, {}, {}], joins }, {});
        assert.strictEqual(r.path, 'graph');
        const info = await ff.probeVideo(out);
        assert.ok(Math.abs(info.duration - 10) < 0.25, `expected ~10 s, got ${info.duration}`);
        assert.strictEqual(info.width, 640, 'mixed sizes are normalised to one canvas');
        const frames = await stats(out);
        const target = await referenceY('0x0d0d0d');

        // Untouched mid-clip brightness really does differ a lot.
        const yLight = at(frames, 1.0).YAVG;
        const yMid = at(frames, 4.5).YAVG;
        const yDark = at(frames, 8.5).YAVG;
        // (the 4:3 middle clip is pillarboxed on the 16:9 canvas, so its average sits below plain mid-grey)
        assert.ok(yLight > 200 && yMid > 70 && yMid < 150 && yDark < 50, `source brightness ${yLight}/${yMid}/${yDark}`);

        // Dark point 1: A's last frame, the hold, B's first frame. Dark point 2: B's last, hold, C's first.
        const points = [
          { name: 'join 1', out: 3.0 - 1 / 30, hold: 3.25, inn: 3.5 },
          { name: 'join 2', out: 6.5 - 1 / 30, hold: 6.75, inn: 7.0 },
        ];
        for (const p of points) {
          const a = at(frames, p.out).YAVG;
          const h = at(frames, p.hold).YAVG;
          const b = at(frames, p.inn).YAVG;
          assert.ok(Math.abs(a - target) <= 1, `${p.name}: outgoing side ${a} vs level ${target}`);
          assert.ok(Math.abs(h - target) <= 1, `${p.name}: hold ${h} vs level ${target}`);
          assert.ok(Math.abs(b - target) <= 1, `${p.name}: incoming side ${b} vs level ${target}`);
          assert.ok(Math.abs(a - b) <= 1, `${p.name}: the two sides differ (${a} vs ${b})`);
        }
        // And the picture really fades: a quarter of the way in is between clip and dip level.
        const quarter = at(frames, 3.0 - 0.5 + 0.125).YAVG;
        assert.ok(quarter < yLight && quarter > target);
      });

      await test('dip to white at an off-white level also meets exactly on both sides', async () => {
        const out = path.join(dir, 'dipwhite.mp4');
        const joins = [normalizeJoin({ type: 'dip_white', level: 95, hold: 0 })];
        await joinClips([dark, mid], out, { clips: [{}, {}], joins }, {});
        const frames = await stats(out);
        const target = await referenceY('0xf2f2f2');
        const a = at(frames, 3.0 - 1 / 30).YAVG;
        const b = at(frames, 3.0).YAVG;
        assert.ok(Math.abs(a - target) <= 1 && Math.abs(b - target) <= 1 && Math.abs(a - b) <= 1, `${a} / ${b} vs ${target}`);
      });

      await test('all joins set to cut and no effects: identical to the current join (and uses it)', async () => {
        const viaNew = path.join(dir, 'cut-new.mp4');
        const viaOld = path.join(dir, 'cut-old.mp4');
        const r = await joinClips([light, mid, dark], viaNew, { clips: [{}, {}, {}], joins: [normalizeJoin({ type: 'cut' }), normalizeJoin({ type: 'cut' })] }, {});
        assert.strictEqual(r.path, 'legacy');
        await ff.joinVideosWithOptionalCrossfade([light, mid, dark], viaOld, { crossfadeSec: 0 });
        assert.strictEqual(await framemd5(viaNew), await framemd5(viaOld), 'frame-for-frame identical');
      });

      await test('one blend type for every join and no effects: identical to the current crossfade', async () => {
        const viaNew = path.join(dir, 'xf-new.mp4');
        const viaOld = path.join(dir, 'xf-old.mp4');
        const r = await joinClips([light, mid], viaNew, { clips: [{}, {}], joins: [normalizeJoin({ type: 'crossfade', duration: 0.6 })] }, {});
        assert.strictEqual(r.path, 'legacy-crossfade');
        await ff.joinVideosWithOptionalCrossfade([light, mid], viaOld, { crossfadeSec: 0.6, transition: 'fade' });
        assert.strictEqual(await framemd5(viaNew), await framemd5(viaOld));
      });

      await test('all cuts but a clip has effects: goes through the prepare stage, never the plain join', async () => {
        const out = path.join(dir, 'fx-cuts.mp4');
        const joins = [normalizeJoin({ type: 'cut' }), normalizeJoin({ type: 'cut' })];
        const clips = [{}, { look: 'bw' }, { trimStart: 1, speed: 2 }];
        const r = await joinClips(colourful, out, { clips, joins }, {}, {
          joinLegacy: async () => { throw new Error('plain join must not be used when a clip has effects'); },
        });
        assert.strictEqual(r.path, 'prepared-concat');
        const frames = await stats(out);
        const red = at(frames, 1.0);
        const bw = at(frames, 4.0);
        assert.ok(Math.abs(red.UAVG - 128) > 10 || Math.abs(red.VAVG - 128) > 10, 'untouched clip keeps its colour');
        assert.ok(Math.abs(bw.UAVG - 128) < 2 && Math.abs(bw.VAVG - 128) < 2, `black-and-white clip is neutral (${bw.UAVG}/${bw.VAVG})`);
        // 3 s + 3 s + (3 s - 1 s trimmed) / 2x speed = 7 s
        const info = await ff.probeVideo(out);
        assert.ok(Math.abs(info.duration - 7) < 0.3, `expected ~7 s, got ${info.duration}`);
      });
      await test('a plan as the editor sends it: clips reordered, effects follow the clip not the position', async () => {
        // Upload order red, green, blue. Play order blue, red, green. Black-and-white is set on RED (index 0).
        const uiPlan = {
          order: [2, 0, 1],
          transition: 'cut',
          transitionSec: 0,
          clips: [{ look: 'bw' }, {}, {}],
          joins: [{ after: 2, type: 'cut' }, { after: 0, type: 'cut' }],
        };
        const plan = normalizeJoinPlan(uiPlan, 3);
        const out = path.join(dir, 'ui-plan.mp4');
        // Same mapping the /join route performs.
        const r = await joinClips(plan.order.map((i) => colourful[i]), out, {
          clips: plan.order.map((i) => plan.clips[i]),
          joins: plan.joins,
        }, {});
        assert.strictEqual(r.path, 'prepared-concat');
        const frames = await stats(out);
        const neutral = (f) => Math.abs(f.UAVG - 128) < 2 && Math.abs(f.VAVG - 128) < 2;
        assert.ok(!neutral(at(frames, 1.5)), 'blue plays first and keeps its colour');
        assert.ok(neutral(at(frames, 4.5)), 'red plays second and is black and white');
        assert.ok(!neutral(at(frames, 7.5)), 'green plays last and keeps its colour');
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  console.log(`\n${passed} passed${skipped ? `, ${skipped} ffmpeg render tests SKIPPED` : ''}`);
  if (skipped) process.exitCode = 2;
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
