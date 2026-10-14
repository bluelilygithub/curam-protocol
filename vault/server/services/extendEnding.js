'use strict';

// Extend ending: hold the last frame of a video for a few seconds so it does not stop dead on its final picture, and let the
// music carry on through that held time, fading out over it. An optional closing message (the Call to action) is then laid over
// the held part by the route, using the existing end-card code, so the message appears while the music fades.
//
// Two ways to get sound under the held frame:
//   'new'  The person chooses the audio file (music, or a voice+music mix). It plays from the start of the video all the way
//          through the hold, repeating smoothly if it is shorter, and fades out over the last `fadeOutSec`. Replaces the
//          video's own sound (like Mute / replace audio).
//   'own'  No file chosen: the video's own sound is kept. It cannot continue into the hold (it ended with the video), so it
//          is faded out over its last `fadeOutSec` and the hold is silent. The page explains this.
//   'none' The video has no sound and none was chosen.
//
// planExtend / buildExtendArgs are pure and tested without ffmpeg (extendEnding.test.js).

const path = require('path');
const { execFileAsync, FFMPEG, probeVideo } = require('./videoFfmpeg');
const { fitMusicToDuration } = require('./music/musicFit');

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
  };
}

/**
 * Work out the lengths and which sound plan applies.
 * @param {{ srcSec: number, hasVideoAudio: boolean, hasNewAudio: boolean, options: object }} input
 */
function planExtend({ srcSec, hasVideoAudio, hasNewAudio, options }) {
  const opts = normalizeExtendOptions(options);
  const total = srcSec + opts.holdSec;
  const audio = hasNewAudio ? 'new' : (hasVideoAudio ? 'own' : 'none');
  // New audio fades out at the very end of the whole piece; the video's own sound can only fade out where it ends (end of the video).
  const fadeLimit = audio === 'own' ? srcSec : total / 2;
  const fadeOutSec = clamp(opts.fadeOutSec, 0, Math.max(0, fadeLimit));
  return { holdSec: opts.holdSec, srcSec, total, audio, fadeOutSec };
}

/** ffmpeg arguments. `audioPath` is the already-fitted audio (plan.audio === 'new'), otherwise null. */
function buildExtendArgs(videoPath, audioPath, outPath, plan) {
  const total = plan.total.toFixed(3);
  const args = ['-y', '-i', videoPath];
  if (plan.audio === 'new') args.push('-i', audioPath);

  const filters = [`[0:v]tpad=stop_mode=clone:stop_duration=${plan.holdSec.toFixed(3)},format=yuv420p[v]`];
  if (plan.audio === 'own') {
    const fade = plan.fadeOutSec > 0 ? `afade=t=out:st=${(plan.srcSec - plan.fadeOutSec).toFixed(3)}:d=${plan.fadeOutSec.toFixed(3)},` : '';
    filters.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,${fade}apad=whole_dur=${total}[a]`);
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[v]');
  if (plan.audio === 'own') args.push('-map', '[a]');
  if (plan.audio === 'new') args.push('-map', '1:a');
  args.push('-t', total, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '18');
  if (plan.audio !== 'none') args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', outPath);
  return args;
}

/**
 * @param {{ videoPath: string, audioPath?: string|null, outPath: string, workDir: string, options?: object }} job
 */
async function extendEnding({ videoPath, audioPath = null, outPath, workDir, options = {} }) {
  const info = await probeVideo(videoPath);
  const srcSec = Number(info.duration) || 0;
  if (!(srcSec > 0)) throw new Error('Could not read how long the video is. Check it is a valid video file.');
  const plan = planExtend({ srcSec, hasVideoAudio: Boolean(info.hasAudio), hasNewAudio: Boolean(audioPath), options });

  let fitted = null;
  if (plan.audio === 'new') {
    fitted = path.join(workDir, 'ending-audio.wav');
    // Repeats smoothly if shorter than the piece, trims if longer, fades out over the chosen time.
    await fitMusicToDuration(audioPath, fitted, plan.total, { fadeOutS: plan.fadeOutSec });
  }
  await execFileAsync(FFMPEG, buildExtendArgs(videoPath, fitted, outPath, plan), 900000);
  return plan;
}

module.exports = { normalizeExtendOptions, planExtend, buildExtendArgs, extendEnding, MIN_HOLD, MAX_HOLD };
