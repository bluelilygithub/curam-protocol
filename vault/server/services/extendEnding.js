'use strict';

// Intro and ending (the tool is still called extend-ending in the API): hold the FIRST frame (so an opening title can sit on it) and
// the LAST frame, with the music carrying on through both and fading out at the end. The opening and closing titles are laid on in
// the SAME encoding pass (videoEndCard.titleStage / prepareTitle): an earlier version re-encoded the whole video once per title,
// which made a job with both titles take three times as long.
//
// Extend ending: hold the last frame of a video for a few seconds so it does not stop dead on its final picture, and let the
// music carry on through that held time, fading out over it. An optional closing message (the Call to action) is then laid over
// the held part by the route, using the existing end-card code, so the message appears while the music fades.
//
// Sound under the held frame. The two files have different jobs, which is the whole point:
//   MUSIC  keeps going for as long as the piece lasts (repeating smoothly if it is shorter) and fades out over `fadeOutSec`.
//   VOICE  plays ONCE from the start and then stops. It is never repeated, so the voice cannot start again in the held frame.
//   'mix'   voice + music: the music dips under the voice (same ducking as Mix audio) and carries on, fading out, after it stops.
//   'music' music only, through the hold, fading out.
//   'voice' voice (or a finished mix) only: plays once, silence after it. A finished voice+music mix ends where it ends: it
//           cannot be extended, which is why the voice and music are best given separately.
//   'own'   no file chosen: the video's own sound is kept. It ended with the video so it cannot continue into the hold; it is
//           faded out over its last `fadeOutSec` and the hold is silent.
//   'none'  a silent video and nothing chosen.
//
// planExtend / buildExtendArgs are pure and tested without ffmpeg (extendEnding.test.js).

const path = require('path');
const { execFileAsync, FFMPEG, probeVideo } = require('./videoFfmpeg');
const { fitMusicToDuration, DUCKING } = require('./music/musicFit');
const { buildAudioMixFilter } = require('./audioMix');
const { titleStage, prepareTitle } = require('./videoEndCard');

const MIN_HOLD = 1;
const MAX_HOLD = 30;
const MAX_INTRO = 15;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v));

function normalizeExtendOptions(raw = {}) {
  const holdSec = clamp(num(raw.holdSec, 4), MIN_HOLD, MAX_HOLD);
  return {
    holdSec,
    introSec: clamp(num(raw.introSec, 0), 0, MAX_INTRO),         // how long the first frame is held before the video moves (0 = none)
    // By default the music fades over exactly the held time.
    fadeOutSec: clamp(num(raw.fadeOutSec, holdSec), 0, 60),
    musicVolume: clamp(num(raw.musicVolume, 0.3), 0.02, 1.5),    // against the voice, when both are given
    ducking: Object.prototype.hasOwnProperty.call(DUCKING, raw.ducking) ? raw.ducking : 'light',
  };
}

/**
 * Work out the lengths and which sound plan applies.
 * @param {{ srcSec: number, hasVideoAudio: boolean, hasNewAudio: boolean, options: object }} input
 */
function planExtend({ srcSec, hasVideoAudio, hasMusic = false, hasVoice = false, options }) {
  const opts = normalizeExtendOptions(options);
  const total = opts.introSec + srcSec + opts.holdSec;
  let audio = 'none';
  if (hasMusic && hasVoice) audio = 'mix';
  else if (hasMusic) audio = 'music';
  else if (hasVoice) audio = 'voice';
  else if (hasVideoAudio) audio = 'own';
  // Music fades out at the very end of the whole piece; the video's own sound can only fade out where it ends (end of the video);
  // a voice is never faded (it just ends).
  let fadeOutSec = 0;
  if (audio === 'mix' || audio === 'music') fadeOutSec = clamp(opts.fadeOutSec, 0, total / 2);
  else if (audio === 'own') fadeOutSec = clamp(opts.fadeOutSec, 0, srcSec);
  return { holdSec: opts.holdSec, introSec: opts.introSec, srcSec, total, audio, fadeOutSec, musicVolume: opts.musicVolume, ducking: opts.ducking };
}

/**
 * The picture half of the filter graph: hold the first/last frame, then (if asked) lay the opening and closing titles on, all in one
 * chain. `titles` = { intro, ending } as made by prepareTitle (or null for none). Pure.
 */
function buildVideoGraph(plan, titles = {}) {
  const holds = [];
  if (plan.introSec > 0) holds.push(`start_mode=clone:start_duration=${plan.introSec.toFixed(3)}`);
  holds.push(`stop_mode=clone:stop_duration=${plan.holdSec.toFixed(3)}`);
  // x264 needs even picture sizes; only an odd-sized source needs touching.
  const evenFix = plan.scale ? `scale=${plan.scale.w}:${plan.scale.h},setsar=1,` : '';
  const hold = `${evenFix}tpad=${holds.join(':')}`;
  const { intro = null, ending = null } = titles || {};
  if (!intro && !ending) return `[0:v]${hold},format=yuv420p[v]`;

  const stages = [`[0:v]${hold}[held]`];
  let label = '[held]';
  [['intro', intro, '[tintI]'], ['ending', ending, '[tintE]']].forEach(([name, t, tint]) => {
    if (!t) return;
    const isLast = name === 'ending' || !ending;
    const out = isLast ? '[v]' : '[afterIntro]';
    stages.push(titleStage({
      inLabel: label, outLabel: out, tintLabel: tint, w: t.w, h: t.h, fps: t.fps, draws: t.draws, enable: t.enable,
      dimPct: t.dimPct, bgColor: t.bgColor, fadeSec: t.fadeSec, fadeDir: t.fadeDir, fadeStart: t.fadeStart, final: isLast,
    }));
    label = out;
  });
  return stages.join(';');
}

/**
 * ffmpeg arguments. `files.music` is the music ALREADY fitted to the whole length (repeated/trimmed, faded out); `files.voice` is the
 * voice as the person gave it. Either may be null, matching plan.audio. `titles` is { intro, ending } from prepareTitle (optional).
 */
function buildExtendArgs(videoPath, files, outPath, plan, titles = {}) {
  const total = plan.total.toFixed(3);
  const { music = null, voice = null } = files && typeof files === 'object' && !Array.isArray(files) ? files : { music: files };
  const args = ['-y', '-i', videoPath];
  const idx = {};
  if (music && (plan.audio === 'music' || plan.audio === 'mix')) { idx.music = args.filter((x) => x === '-i').length; args.push('-i', music); }
  if (voice && (plan.audio === 'voice' || plan.audio === 'mix')) { idx.voice = args.filter((x) => x === '-i').length; args.push('-i', voice); }

  // Hold the first frame (intro) and the last frame (ending), and lay any titles on, in one chain.
  const filters = [buildVideoGraph(plan, titles)];
  // Anything that belongs to the video itself (a voice, the video's own sound) starts when the video starts moving, after the
  // opening hold. The music starts at 0 so the title has music under it.
  const delay = plan.introSec > 0 ? `adelay=${Math.round(plan.introSec * 1000)}:all=1,` : '';
  let audioMap = null;
  if (plan.audio === 'own') {
    const fade = plan.fadeOutSec > 0 ? `afade=t=out:st=${(plan.introSec + plan.srcSec - plan.fadeOutSec).toFixed(3)}:d=${plan.fadeOutSec.toFixed(3)},` : '';
    filters.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,${delay}${fade}apad=whole_dur=${total}[a]`);
    audioMap = '[a]';
  } else if (plan.audio === 'voice') {
    // Plays once from the start of the video; whatever remains of the piece is silence. Never repeated.
    filters.push(`[${idx.voice}:a]aformat=sample_rates=48000:channel_layouts=stereo,${delay}apad=whole_dur=${total}[a]`);
    audioMap = '[a]';
  } else if (plan.audio === 'mix') {
    // Same mix as Mix audio: voice once (after the opening hold), music ducked under it, music carrying on (already faded out) after the voice stops.
    filters.push(buildAudioMixFilter(
      { musicVolume: plan.musicVolume, voiceVolume: 1, ducking: plan.ducking, leadInSec: plan.introSec },
      plan.total,
      { music: idx.music, voice: idx.voice },
    ));
    audioMap = '[aout]';
  } else if (plan.audio === 'music') {
    audioMap = `${idx.music}:a`;
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[v]');
  if (audioMap) args.push('-map', audioMap);
  args.push('-t', total, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '18');
  if (audioMap) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', outPath);
  return args;
}

/**
 * @param {{ videoPath: string, musicPath?: string|null, voicePath?: string|null, outPath: string, workDir: string, options?: object }} job
 */
async function extendEnding({ videoPath, musicPath = null, voicePath = null, outPath, workDir, options = {}, titles = {} }) {
  const info = await probeVideo(videoPath);
  const srcSec = Number(info.duration) || 0;
  if (!(srcSec > 0)) throw new Error('Could not read how long the video is. Check it is a valid video file.');
  const plan = planExtend({ srcSec, hasVideoAudio: Boolean(info.hasAudio), hasMusic: Boolean(musicPath), hasVoice: Boolean(voicePath), options });
  if (!info.width || !info.height) throw new Error('Could not read the video size');
  const even = { w: info.width - (info.width % 2), h: info.height - (info.height % 2) };
  if (even.w !== info.width || even.h !== info.height) plan.scale = even;
  const fpsParts = String(info.fps || '30/1').split('/').map(Number);
  const fps = clamp(fpsParts[1] > 0 ? fpsParts[0] / fpsParts[1] : (fpsParts[0] || 30), 1, 60);
  const size = { ...even, fps };

  // Prepare the titles (text files, font) now that the picture size and the final length are known.
  const prepared = {};
  if (titles.intro) prepared.intro = await prepareTitle({ spec: titles.intro, kind: 'intro', introSec: plan.introSec, totalSec: plan.total, size, workDir });
  if (titles.ending) {
    prepared.ending = await prepareTitle({
      spec: { ...titles.ending, durationSec: Math.min(plan.holdSec, 15) }, kind: 'ending', totalSec: plan.total, size, workDir,
    });
  }

  let fitted = null;
  if (plan.audio === 'music' || plan.audio === 'mix') {
    fitted = path.join(workDir, 'ending-music.wav');
    // Repeats smoothly if shorter than the piece, trims if longer, fades out over the chosen time.
    await fitMusicToDuration(musicPath, fitted, plan.total, { fadeOutS: plan.fadeOutSec });
  }
  const files = { music: fitted, voice: plan.audio === 'voice' || plan.audio === 'mix' ? voicePath : null };
  try {
    await execFileAsync(FFMPEG, buildExtendArgs(videoPath, files, outPath, plan, prepared), 900000);
  } catch (err) {
    // The smooth tint fade is the only part needing an unusual filter chain. If this machine's ffmpeg rejects it, still deliver the
    // video with each tint switching on/off at once, rather than failing the whole job.
    const smooth = [prepared.intro, prepared.ending].some((t) => t && t.fadeSec > 0 && t.dimPct > 0);
    if (!smooth || err.killed) throw err;
    const instant = {};
    ['intro', 'ending'].forEach((k) => { if (prepared[k]) instant[k] = { ...prepared[k], fadeSec: 0 }; });
    await execFileAsync(FFMPEG, buildExtendArgs(videoPath, files, outPath, plan, instant), 900000);
  }
  return plan;
}

module.exports = { normalizeExtendOptions, planExtend, buildVideoGraph, buildExtendArgs, extendEnding, MIN_HOLD, MAX_HOLD, MAX_INTRO };
