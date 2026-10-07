'use strict';

// Fit a generated music clip to a video and mix it in. All ffmpeg; filter builders are pure so
// they are unit-tested without ffmpeg.
//
// LONGER-THAN-ONE-CLIP VIDEOS: the clip is looped with equal-power crossfades, not extended by
// "continuation". Reasons: (1) one generation per option instead of one per 30s block, so a
// 3-minute video costs the same as a 20-second one; (2) continuation conditions on the end of the
// previous block and drifts in key/tempo over many blocks, and its output semantics depend on the
// hosted model; (3) a 2s qsin crossfade over a 30s clip is not audible as a seam for
// background music. The trade-off is repetition: after ~30s the same phrase returns. For a
// background bed that is the normal behaviour of stock music; if it bothers you, shorter videos
// or a different backend avoid it.

const { execFileAsync, FFMPEG, probeVideo } = require('../videoFfmpeg');

const LOOP_CROSSFADE_S = 2;
const FADE_IN_S = 0.5;
const FADE_OUT_S = 2;
const TARGET_LUFS = -14;
const SAMPLE_RATE = 44100;

const DUCKING = {
  off: null,
  // Thresholds are linear amplitude of the speech sidechain. Speech sits around -25..-20 dBFS RMS
  // (0.05-0.1), so these engage on normal speaking level: measured ~3-4 dB of dip (light) and ~9 dB (strong).
  light: { threshold: 0.02, ratio: 3, attack: 30, release: 300 },
  strong: { threshold: 0.015, ratio: 8, attack: 20, release: 500 },
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * How many copies of a clip, joined with a crossfade, cover `targetS`.
 * Total length of n copies = n*clip - (n-1)*xf.
 */
function planLoop(clipS, targetS, crossfadeS = LOOP_CROSSFADE_S) {
  const clip = Number(clipS);
  const target = Number(targetS);
  if (!(clip > 0) || !(target > 0)) throw new Error('Cannot fit music: unknown clip or video length');
  if (clip >= target) return { copies: 1, crossfadeS: 0 };
  const xf = Math.min(crossfadeS, clip / 4);
  const copies = Math.ceil((target - xf) / (clip - xf));
  return { copies: Math.max(2, copies), crossfadeS: xf };
}

/** Fade lengths that always fit, even for very short videos. */
function fadeTimes(targetS) {
  const fadeIn = Math.min(FADE_IN_S, targetS / 6);
  const fadeOut = Math.min(FADE_OUT_S, targetS / 3);
  return { fadeIn, fadeOut, fadeOutStart: Math.max(0, targetS - fadeOut) };
}

/** filter_complex that loops `copies` inputs (all the same clip), trims to length and fades. */
function buildFitFilter({ copies, crossfadeS, targetS }) {
  const { fadeIn, fadeOut, fadeOutStart } = fadeTimes(targetS);
  const parts = [];
  let last = '[0:a]';
  for (let i = 1; i < copies; i += 1) {
    const out = `[x${i}]`;
    parts.push(`${last}[${i}:a]acrossfade=d=${crossfadeS.toFixed(3)}:c1=qsin:c2=qsin${out}`);
    last = out;
  }
  parts.push(
    `${last}atrim=0:${targetS.toFixed(3)},asetpts=PTS-STARTPTS,`
    + `afade=t=in:st=0:d=${fadeIn.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)},`
    + `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo[fit]`
  );
  return parts.join(';');
}

/** Loop/trim `clipPath` to exactly `targetS` seconds with fade in/out → WAV at `outPath`. */
async function fitMusicToDuration(clipPath, outPath, targetS) {
  const probe = await probeVideo(clipPath);
  const { copies, crossfadeS } = planLoop(probe.duration, targetS);
  const inputs = Array.from({ length: copies }, () => ['-i', clipPath]).flat();
  await execFileAsync(FFMPEG, [
    '-y', ...inputs,
    '-filter_complex', buildFitFilter({ copies, crossfadeS, targetS }),
    '-map', '[fit]', '-t', targetS.toFixed(3),
    '-c:a', 'pcm_s16le', outPath,
  ], 300000);
  return { copies, clipS: probe.duration };
}

function normalizeMixSettings({ volume, ducking } = {}) {
  return {
    volume: clamp(Number.isFinite(Number(volume)) ? Number(volume) : 0.7, 0, 1.5),
    ducking: Object.prototype.hasOwnProperty.call(DUCKING, ducking) ? ducking : 'light',
  };
}

/** filter_complex for the final mix. `hasAudio` = the video already has a soundtrack to duck under. */
function buildMixFilter({ hasAudio, volume, ducking }) {
  const loud = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  if (!hasAudio) return `[1:a]volume=${volume.toFixed(3)},${loud}[aout]`;

  const duck = DUCKING[ducking];
  const voice = `[0:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;
  if (!duck) {
    return `${voice}[voice];[1:a]volume=${volume.toFixed(3)}[m];`
      + `[voice][m]amix=inputs=2:duration=first:normalize=0[mixed];[mixed]${loud}[aout]`;
  }
  return `${voice},asplit=2[voice][sc];[1:a]volume=${volume.toFixed(3)}[m];`
    + `[m][sc]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:attack=${duck.attack}:release=${duck.release}:makeup=1[duck];`
    + `[voice][duck]amix=inputs=2:duration=first:normalize=0[mixed];[mixed]${loud}[aout]`;
}

/**
 * Mix fitted music into the video. `preview` re-encodes small and fast for in-browser playback;
 * otherwise the picture is stream-copied (lossless, quick), falling back to a re-encode when the
 * source codec can't go into MP4 as-is.
 */
async function mixMusicWithVideo({ videoPath, musicPath, outPath, durationS, hasAudio, volume, ducking, preview = false }) {
  const settings = normalizeMixSettings({ volume, ducking });
  const common = [
    '-y', '-i', videoPath, '-i', musicPath,
    '-filter_complex', buildMixFilter({ hasAudio, ...settings }),
    '-map', '0:v:0', '-map', '[aout]',
    '-c:a', 'aac', '-b:a', '192k', '-ar', String(SAMPLE_RATE),
    '-t', durationS.toFixed(3), '-movflags', '+faststart',
  ];
  const encode = ['-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'fast', '-crf', preview ? '28' : '20', '-pix_fmt', 'yuv420p'];
  if (preview) {
    await execFileAsync(FFMPEG, [...common, '-vf', 'scale=-2:480', ...encode, outPath], 600000);
    return;
  }
  try {
    await execFileAsync(FFMPEG, [...common, '-c:v', 'copy', outPath], 600000);
  } catch {
    await execFileAsync(FFMPEG, [...common, ...encode, outPath], 900000);
  }
}

module.exports = {
  LOOP_CROSSFADE_S, FADE_IN_S, FADE_OUT_S, TARGET_LUFS, DUCKING,
  planLoop, fadeTimes, buildFitFilter, buildMixFilter, normalizeMixSettings,
  fitMusicToDuration, mixMusicWithVideo,
};
