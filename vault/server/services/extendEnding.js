'use strict';

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

const MIN_HOLD = 1;
const MAX_HOLD = 30;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v));

function normalizeExtendOptions(raw = {}) {
  const holdSec = clamp(num(raw.holdSec, 4), MIN_HOLD, MAX_HOLD);
  return {
    holdSec,
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
  const total = srcSec + opts.holdSec;
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
  return { holdSec: opts.holdSec, srcSec, total, audio, fadeOutSec, musicVolume: opts.musicVolume, ducking: opts.ducking };
}

/**
 * ffmpeg arguments. `files.music` is the music ALREADY fitted to the whole length (repeated/trimmed, faded out); `files.voice` is the
 * voice as the person gave it. Either may be null, matching plan.audio.
 */
function buildExtendArgs(videoPath, files, outPath, plan) {
  const total = plan.total.toFixed(3);
  const { music = null, voice = null } = files && typeof files === 'object' && !Array.isArray(files) ? files : { music: files };
  const args = ['-y', '-i', videoPath];
  const idx = {};
  if (music && (plan.audio === 'music' || plan.audio === 'mix')) { idx.music = args.filter((x) => x === '-i').length; args.push('-i', music); }
  if (voice && (plan.audio === 'voice' || plan.audio === 'mix')) { idx.voice = args.filter((x) => x === '-i').length; args.push('-i', voice); }

  const filters = [`[0:v]tpad=stop_mode=clone:stop_duration=${plan.holdSec.toFixed(3)},format=yuv420p[v]`];
  let audioMap = null;
  if (plan.audio === 'own') {
    const fade = plan.fadeOutSec > 0 ? `afade=t=out:st=${(plan.srcSec - plan.fadeOutSec).toFixed(3)}:d=${plan.fadeOutSec.toFixed(3)},` : '';
    filters.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,${fade}apad=whole_dur=${total}[a]`);
    audioMap = '[a]';
  } else if (plan.audio === 'voice') {
    // Plays once from the start; whatever remains of the piece is silence. Never repeated.
    filters.push(`[${idx.voice}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${total}[a]`);
    audioMap = '[a]';
  } else if (plan.audio === 'mix') {
    // Same mix as Mix audio: voice once, music ducked under it, music carrying on (already faded out) after the voice stops.
    filters.push(buildAudioMixFilter(
      { musicVolume: plan.musicVolume, voiceVolume: 1, ducking: plan.ducking, leadInSec: 0 },
      plan.total,
      { music: idx.music, voice: idx.voice },
    ));
    audioMap = '[aout]';
  } else if (plan.audio === 'music') {
    audioMap = `${idx.music}:a`;
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[v]');
  if (audioMap) args.push('-map', audioMap);
  args.push('-t', total, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '18');
  if (audioMap) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', outPath);
  return args;
}

/**
 * @param {{ videoPath: string, musicPath?: string|null, voicePath?: string|null, outPath: string, workDir: string, options?: object }} job
 */
async function extendEnding({ videoPath, musicPath = null, voicePath = null, outPath, workDir, options = {} }) {
  const info = await probeVideo(videoPath);
  const srcSec = Number(info.duration) || 0;
  if (!(srcSec > 0)) throw new Error('Could not read how long the video is. Check it is a valid video file.');
  const plan = planExtend({ srcSec, hasVideoAudio: Boolean(info.hasAudio), hasMusic: Boolean(musicPath), hasVoice: Boolean(voicePath), options });

  let fitted = null;
  if (plan.audio === 'music' || plan.audio === 'mix') {
    fitted = path.join(workDir, 'ending-music.wav');
    // Repeats smoothly if shorter than the piece, trims if longer, fades out over the chosen time.
    await fitMusicToDuration(musicPath, fitted, plan.total, { fadeOutS: plan.fadeOutSec });
  }
  await execFileAsync(FFMPEG, buildExtendArgs(videoPath, { music: fitted, voice: plan.audio === 'voice' || plan.audio === 'mix' ? voicePath : null }, outPath, plan), 900000);
  return plan;
}

module.exports = { normalizeExtendOptions, planExtend, buildExtendArgs, extendEnding, MIN_HOLD, MAX_HOLD };
