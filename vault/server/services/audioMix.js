'use strict';

// Mix audio: a voice (foreground) and a piece of music (background) combined into one audio file.
//
// Built from the pieces the Music page already uses, so it behaves the same way:
//   - the music is repeated with smooth crossfades (musicFit.fitMusicToDuration) or trimmed to fit, and fades in and out;
//   - the music ducks (dips) while the voice is speaking, using the same light/strong presets;
//   - the result is levelled to a standard loudness so it is neither quiet nor clipped.
// The filter builder is pure so it is tested without ffmpeg (audioMix.test.js).

const path = require('path');
const { execFileAsync, FFMPEG, probeVideo } = require('./videoFfmpeg');
const { fitMusicToDuration, DUCKING } = require('./music/musicFit');

const SAMPLE_RATE = 44100;
const TARGET_LUFS = -16; // spoken-word standard (podcasts, voiceovers); the Music page uses -14 for video
const MAX_TOTAL_SEC = 3 * 60 * 60;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const num = (v, fallback) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v));

/** Everything the person can set, clamped to what makes sense. */
function normalizeMixOptions(raw = {}) {
  return {
    musicVolume: clamp(num(raw.musicVolume, 0.3), 0.02, 1.5),     // 1 = as loud as the voice file was recorded
    voiceVolume: clamp(num(raw.voiceVolume, 1), 0.2, 2),
    ducking: Object.prototype.hasOwnProperty.call(DUCKING, raw.ducking) ? raw.ducking : 'light', // 'off' | 'light' | 'strong'
    leadInSec: clamp(num(raw.leadInSec, 0), 0, 30),                // music plays this long before the voice starts
    tailSec: clamp(num(raw.tailSec, 3), 0, 60),                    // music keeps playing this long after the voice ends
    format: raw.format === 'wav' ? 'wav' : 'mp3',
  };
}

/** How long the finished piece is. */
function totalLength(voiceSec, opts) {
  return Number(voiceSec) + opts.leadInSec + opts.tailSec;
}

/**
 * filter_complex. Input 0 = the music, already fitted to the full length; input 1 = the voice.
 * The voice is delayed by the lead-in, padded to the full length and (optionally) drives the ducking of the music.
 */
function buildAudioMixFilter(opts, totalSec) {
  const total = Number(totalSec).toFixed(3);
  const delayMs = Math.round(opts.leadInSec * 1000);
  const loud = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  const voice = `[1:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,adelay=${delayMs}:all=1,`
    + `volume=${opts.voiceVolume.toFixed(3)},apad=whole_dur=${total},atrim=0:${total},asetpts=PTS-STARTPTS[vo0]`;
  const music = `[0:a]volume=${opts.musicVolume.toFixed(3)}[m]`;
  const duck = DUCKING[opts.ducking];
  if (!duck) return `${voice};${music};[vo0][m]amix=inputs=2:duration=first:normalize=0[mixed];[mixed]${loud}[aout]`;
  return `${voice};[vo0]asplit=2[vo][key];${music};`
    + `[m][key]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:attack=${duck.attack}:release=${duck.release}:makeup=1[ducked];`
    + `[vo][ducked]amix=inputs=2:duration=first:normalize=0[mixed];[mixed]${loud}[aout]`;
}

/** Encoder arguments for the chosen format. */
function encoderArgs(format) {
  return format === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '192k'];
}

/**
 * @param {{ voicePath: string, musicPath: string, outPath: string, workDir: string, options?: object }} job
 * @returns {Promise<{ seconds: number, options: object, copies: number }>}
 */
async function mixAudio({ voicePath, musicPath, outPath, workDir, options = {} }) {
  const opts = normalizeMixOptions(options);
  const voiceInfo = await probeVideo(voicePath);
  const voiceSec = Number(voiceInfo.duration) || 0;
  if (!(voiceSec > 0)) throw new Error('Could not read how long the voice recording is. Check it is a valid audio file.');
  const total = totalLength(voiceSec, opts);
  if (total > MAX_TOTAL_SEC) throw new Error('That is too long to mix in one go (over 3 hours). Mix it in parts.');

  const fittedPath = path.join(workDir, 'music-fitted.wav');
  const fit = await fitMusicToDuration(musicPath, fittedPath, total);
  await execFileAsync(FFMPEG, [
    '-y', '-i', fittedPath, '-i', voicePath,
    '-filter_complex', buildAudioMixFilter(opts, total),
    '-map', '[aout]', '-t', total.toFixed(3),
    ...encoderArgs(opts.format), outPath,
  ], 900000);
  return { seconds: total, options: opts, copies: fit.copies };
}

module.exports = {
  normalizeMixOptions, totalLength, buildAudioMixFilter, encoderArgs, mixAudio,
  TARGET_LUFS, MAX_TOTAL_SEC,
};
