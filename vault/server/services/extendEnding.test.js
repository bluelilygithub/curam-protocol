'use strict';
const assert = require('assert');
const { normalizeExtendOptions, planExtend, buildExtendArgs } = require('./extendEnding');
const { buildFitFilter, fadeTimes } = require('./music/musicFit');

const arg = (args, flag) => args[args.indexOf(flag) + 1];
const inputsOf = (args) => args.reduce((acc, x, i) => (x === '-i' ? [...acc, args[i + 1]] : acc), []);
const plan = (o) => planExtend({ srcSec: 30, hasVideoAudio: true, hasMusic: false, hasVoice: false, options: { holdSec: 5 }, ...o });

// ---- options ----
assert.deepStrictEqual(normalizeExtendOptions({}), { holdSec: 4, introSec: 0, fadeOutSec: 4, musicVolume: 0.3, ducking: 'light' }, 'the music fades over exactly the held time by default; no opening hold unless asked');
assert.strictEqual(normalizeExtendOptions({ introSec: '3' }).introSec, 3);
assert.strictEqual(normalizeExtendOptions({ introSec: 999 }).introSec, 15);
assert.strictEqual(normalizeExtendOptions({ introSec: -2 }).introSec, 0);
assert.deepStrictEqual(normalizeExtendOptions({ holdSec: '6' }).fadeOutSec, 6);
assert.deepStrictEqual(normalizeExtendOptions({ holdSec: 0, fadeOutSec: -3 }).holdSec, 1, 'at least a second');
assert.strictEqual(normalizeExtendOptions({ holdSec: 0, fadeOutSec: -3 }).fadeOutSec, 0, 'no negative fade');
assert.strictEqual(normalizeExtendOptions({ holdSec: 999 }).holdSec, 30);
assert.strictEqual(normalizeExtendOptions({ holdSec: 5, fadeOutSec: '' }).fadeOutSec, 5, 'empty means default, not zero');
assert.strictEqual(normalizeExtendOptions({ holdSec: 5, fadeOutSec: 0 }).fadeOutSec, 0, 'zero means no fade');
assert.strictEqual(normalizeExtendOptions({ musicVolume: 99, ducking: 'banana' }).musicVolume, 1.5);
assert.strictEqual(normalizeExtendOptions({ ducking: 'banana' }).ducking, 'light');
assert.strictEqual(normalizeExtendOptions({ ducking: 'strong' }).ducking, 'strong');

// ---- which sound plan: voice and music each have their own job ----
assert.strictEqual(plan({ hasMusic: true, hasVoice: true }).audio, 'mix');
assert.strictEqual(plan({ hasMusic: true }).audio, 'music');
assert.strictEqual(plan({ hasVoice: true }).audio, 'voice');
assert.strictEqual(plan({}).audio, 'own');
assert.strictEqual(plan({ hasVideoAudio: false }).audio, 'none');
assert.deepStrictEqual([plan({ hasMusic: true }).total, plan({ hasMusic: true }).fadeOutSec], [35, 5]);
assert.strictEqual(plan({ hasVoice: true }).fadeOutSec, 0, 'a voice is never faded; it just ends');
assert.strictEqual(planExtend({ srcSec: 4, hasVideoAudio: true, hasMusic: true, options: { holdSec: 2, fadeOutSec: 60 } }).fadeOutSec, 3, 'music fade: at most half the piece');
assert.strictEqual(planExtend({ srcSec: 4, hasVideoAudio: true, options: { holdSec: 2, fadeOutSec: 60 } }).fadeOutSec, 4, "own sound: at most the video's length (it ends there)");

// ---- THE FIX: voice + music. The voice is its own input and is never looped; the music carries on after it ----
const mixPlan = plan({ hasMusic: true, hasVoice: true });
let a = buildExtendArgs('in.mp4', { music: 'music-fitted.wav', voice: 'voice.mp3' }, 'out.mp4', mixPlan);
assert.deepStrictEqual(inputsOf(a), ['in.mp4', 'music-fitted.wav', 'voice.mp3'], 'video, then the (already fitted) music, then the voice as given');
let fc = arg(a, '-filter_complex');
assert.match(fc, /^\[0:v\]tpad=stop_mode=clone:stop_duration=5\.000,format=yuv420p\[v\];/);
assert.match(fc, /\[2:a\]aformat=.*adelay=0:all=1,.*apad=whole_dur=35\.000,atrim=0:35\.000/, 'the voice (input 2) is padded with silence to the end, NOT repeated');
assert.match(fc, /\[1:a\]volume=0\.300\[m\]/, 'the music (input 1) sits under it');
assert.match(fc, /sidechaincompress/, 'the music dips under the voice');
assert.ok(!/aloop|stream_loop/.test(a.join(' ') + fc), 'nothing loops the voice');
assert.ok(a.includes('[aout]') && a.includes('[v]'));
assert.strictEqual(arg(a, '-t'), '35.000');
assert.strictEqual(arg(a, '-c:a'), 'aac');
// ducking off / strong carry through
assert.ok(!arg(buildExtendArgs('in.mp4', { music: 'm.wav', voice: 'v.mp3' }, 'o.mp4', planExtend({ srcSec: 30, hasVideoAudio: true, hasMusic: true, hasVoice: true, options: { holdSec: 5, ducking: 'off' } })), '-filter_complex').includes('sidechaincompress'));

// ---- music only: through the hold, as before ----
a = buildExtendArgs('in.mp4', { music: 'fit.wav', voice: null }, 'out.mp4', plan({ hasMusic: true }));
assert.deepStrictEqual(inputsOf(a), ['in.mp4', 'fit.wav']);
assert.strictEqual(arg(a, '-filter_complex'), '[0:v]tpad=stop_mode=clone:stop_duration=5.000,format=yuv420p[v]');
assert.ok(a.includes('1:a'));
assert.strictEqual(arg(a, '-crf'), '18');
assert.strictEqual(arg(a, '-pix_fmt'), 'yuv420p');

// ---- voice only (or a finished mix): plays once, silence after; never repeated ----
a = buildExtendArgs('in.mp4', { music: null, voice: 'voice.mp3' }, 'out.mp4', plan({ hasVoice: true }));
assert.deepStrictEqual(inputsOf(a), ['in.mp4', 'voice.mp3']);
fc = arg(a, '-filter_complex');
assert.match(fc, /\[1:a\]aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=35\.000\[a\]/);
assert.ok(!/aloop|stream_loop/.test(a.join(' ') + fc));
assert.ok(a.includes('[a]'));

// ---- the video's own sound (no files): faded out where it ends, then silence ----
a = buildExtendArgs('in.mp4', { music: null, voice: null }, 'out.mp4', plan({ options: { holdSec: 5, fadeOutSec: 3 } }));
assert.strictEqual(inputsOf(a).length, 1);
fc = arg(a, '-filter_complex');
assert.match(fc, /afade=t=out:st=27\.000:d=3\.000/);
assert.match(fc, /apad=whole_dur=35\.000\[a\]/);
a = buildExtendArgs('in.mp4', { music: null, voice: null }, 'out.mp4', plan({ options: { holdSec: 5, fadeOutSec: 0 } }));
assert.ok(!arg(a, '-filter_complex').includes('afade'));

// ---- a silent video and no files: no audio streams at all ----
a = buildExtendArgs('in.mp4', {}, 'out.mp4', plan({ hasVideoAudio: false }));
assert.ok(!a.includes('-c:a') && !a.includes('[a]') && !a.includes('1:a'));
// old call style (a single fitted-music path) still works
a = buildExtendArgs('in.mp4', 'fit.wav', 'out.mp4', plan({ hasMusic: true }));
assert.deepStrictEqual(inputsOf(a), ['in.mp4', 'fit.wav']);

// ---- the shared music-fit code: custom fades work, defaults are untouched ----
assert.deepStrictEqual(fadeTimes(30), { fadeIn: 0.5, fadeOut: 2, fadeOutStart: 28 }, 'Music page defaults unchanged');
assert.deepStrictEqual(fadeTimes(35, { fadeOutS: 5 }), { fadeIn: 0.5, fadeOut: 5, fadeOutStart: 30 });
assert.strictEqual(fadeTimes(10, { fadeOutS: 99 }).fadeOut, 5, 'never more than half the piece');
assert.strictEqual(fadeTimes(10, { fadeOutS: 0 }).fadeOut, 0);
assert.match(buildFitFilter({ copies: 1, crossfadeS: 0, targetS: 35, fades: { fadeOutS: 5 } }), /afade=t=out:st=30\.000:d=5\.000/);
assert.ok(!buildFitFilter({ copies: 1, crossfadeS: 0, targetS: 35, fades: { fadeOutS: 0 } }).includes('afade=t=out'), 'no zero-length fade (ffmpeg rejects it)');

// ---- OPENING hold: the first frame is held, the voice waits for the video to start, the music starts at once ----
const introPlan = (o) => planExtend({ srcSec: 30, hasVideoAudio: true, hasMusic: false, hasVoice: false, options: { holdSec: 5, introSec: 3 }, ...o });
let ip = introPlan({ hasMusic: true, hasVoice: true });
assert.strictEqual(ip.total, 38, 'opening hold + video + closing hold');
a = buildExtendArgs('in.mp4', { music: 'm.wav', voice: 'v.mp3' }, 'o.mp4', ip);
fc = arg(a, '-filter_complex');
assert.match(fc, /^\[0:v\]tpad=start_mode=clone:start_duration=3\.000:stop_mode=clone:stop_duration=5\.000,format=yuv420p\[v\];/, 'first AND last frame held');
assert.match(fc, /\[2:a\]aformat=.*adelay=3000:all=1/, 'the voice starts when the video starts moving');
assert.match(fc, /\[1:a\]volume=0\.300\[m\]/, 'the music is not delayed: it plays under the opening title');
assert.match(fc, /apad=whole_dur=38\.000,atrim=0:38\.000/);
assert.strictEqual(arg(a, '-t'), '38.000');
// music only is untouched by the opening hold (it starts at 0 and covers the longer piece)
a = buildExtendArgs('in.mp4', { music: 'm.wav' }, 'o.mp4', introPlan({ hasMusic: true }));
assert.ok(!arg(a, '-filter_complex').includes('adelay'));
assert.match(arg(a, '-filter_complex'), /start_duration=3\.000/);
// voice only waits for the video; the video's own sound waits too, and its fade ends where the video ends (after the opening hold)
a = buildExtendArgs('in.mp4', { voice: 'v.mp3' }, 'o.mp4', introPlan({ hasVoice: true }));
assert.match(arg(a, '-filter_complex'), /\[1:a\]aformat=sample_rates=48000:channel_layouts=stereo,adelay=3000:all=1,apad=whole_dur=38\.000\[a\]/);
a = buildExtendArgs('in.mp4', {}, 'o.mp4', introPlan({ options: { holdSec: 5, introSec: 3, fadeOutSec: 3 } }));
fc = arg(a, '-filter_complex');
assert.match(fc, /adelay=3000:all=1,afade=t=out:st=30\.000:d=3\.000,apad=whole_dur=38\.000/, 'own sound: delayed by the opening hold, fade ends where the video ends (3 + 30)');
// no opening hold = exactly as before
a = buildExtendArgs('in.mp4', { music: 'm.wav', voice: 'v.mp3' }, 'o.mp4', plan({ hasMusic: true, hasVoice: true }));
assert.match(arg(a, '-filter_complex'), /^\[0:v\]tpad=stop_mode=clone:stop_duration=5\.000,format=yuv420p\[v\]/);
assert.match(arg(a, '-filter_complex'), /adelay=0:all=1/);

// ---- titles go in the SAME pass: one ffmpeg run, one encode, however many titles ----
const { buildVideoGraph } = require('./extendEnding');
const mk = (kind, extra = {}) => ({ kind, w: 1280, h: 720, fps: 30, draws: [`drawtext=text='${kind}'`], enable: ":enable='lte(t,5)'", dimPct: 60, bgColor: '112233', fadeSec: 2, fadeDir: kind === 'intro' ? 'out' : 'in', fadeStart: kind === 'intro' ? 3 : 33, ...extra });
const tp = planExtend({ srcSec: 30, hasVideoAudio: true, hasMusic: true, hasVoice: true, options: { holdSec: 5, introSec: 3 } });
// neither title: unchanged simple chain
assert.strictEqual(buildVideoGraph(tp, {}), '[0:v]tpad=start_mode=clone:start_duration=3.000:stop_mode=clone:stop_duration=5.000,format=yuv420p[v]');
// both titles: held picture -> opening piece -> closing piece -> [v]
let vg = buildVideoGraph(tp, { intro: mk('intro'), ending: mk('ending') });
const pieces = vg.split(';');
assert.match(pieces[0], /^\[0:v\]tpad=.*\[held\]$/);
assert.ok(/fade=t=out:st=3\.000/.test(vg) && /fade=t=in:st=33\.000/.test(vg), 'opening fades out after its hold; closing fades in at its start');
assert.ok(vg.includes('[held][tintI]overlay') && vg.includes('[afterIntro][tintE]overlay'), 'the closing piece reads what the opening piece wrote');
assert.ok(vg.endsWith('format=yuv420p[v]'));
assert.strictEqual((vg.match(/\[v\]/g) || []).length, 1, 'one final video label');
// a single title: that piece is the last one
vg = buildVideoGraph(tp, { intro: mk('intro') });
assert.ok(vg.endsWith('format=yuv420p[v]') && !vg.includes('afterIntro'));
vg = buildVideoGraph(tp, { ending: mk('ending') });
assert.ok(vg.includes('[held][tintE]overlay') && vg.endsWith('format=yuv420p[v]'));
// the whole job is ONE ffmpeg command with ONE video encode
a = buildExtendArgs('in.mp4', { music: 'm.wav', voice: 'v.mp3' }, 'out.mp4', tp, { intro: mk('intro'), ending: mk('ending') });
assert.strictEqual(a.filter((x) => x === 'libx264').length, 1, 'the video is encoded once');
assert.strictEqual(a.filter((x) => x === '-filter_complex').length, 1);
assert.strictEqual(arg(a, '-preset'), 'fast', 'fast, not the slowest setting, at the same quality number');
assert.strictEqual(arg(a, '-crf'), '18');
assert.ok(a.includes('[v]') && a.includes('[aout]'));
// the title graph and the sound graph are joined into the one filter_complex
assert.ok(arg(a, '-filter_complex').includes('sidechaincompress') && arg(a, '-filter_complex').includes('overlay=shortest=1'));
// an odd-sized picture is made even first (x264 refuses odd sizes)
assert.match(buildVideoGraph({ ...tp, scale: { w: 1280, h: 718 } }, {}), /^\[0:v\]scale=1280:718,setsar=1,tpad=/);

console.log('extendEnding tests passed');
