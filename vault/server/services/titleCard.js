'use strict';

// Title card: a message card (headline, supporting line, optional button and web address, over an adjustable tint) shown between a
// start and an end time in the MIDDLE of a video. The same card as the opening and closing titles of Intro and ending, but placed
// anywhere. The video's length is unchanged (the card sits over the playing picture) and its soundtrack is copied untouched.
//
// planTitleCard is pure and tested (titleCard.test.js); the picture graph is videoEndCard.windowTitleStage.

const { execFileAsync, FFMPEG, probeVideo } = require('./videoFfmpeg');
const { windowTitleStage, prepareWindowTitle } = require('./videoEndCard');

const MIN_SECONDS = 0.5;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const s1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

/** The window the card is on screen, checked against the video. Throws plain-worded errors. */
function planTitleCard({ videoSec, startSec, endSec }) {
  const dur = Number(videoSec);
  if (!(dur > 0)) throw new Error('Could not read how long your video is. Check it is a valid video file.');
  const start = Math.max(0, Number(startSec) || 0);
  const end = Number(endSec);
  if (!Number.isFinite(end)) throw new Error('Set when the card ends.');
  if (start >= dur - 0.1) throw new Error(`The card starts at ${s1(start)} s, but your video is only ${s1(dur)} s long.`);
  const last = Math.min(end, dur);
  if (last - start < MIN_SECONDS) throw new Error(`The card needs to be on screen for at least ${MIN_SECONDS} seconds. Move the end later than ${s1(start + MIN_SECONDS)} s.`);
  return { start: Math.round(start * 1000) / 1000, end: Math.round(last * 1000) / 1000, clampedToEnd: end > dur + 0.05 };
}

/** The whole picture graph: the video as it is, with the card on top between the two times. */
function buildTitleCardGraph({ prepared, scale = null }) {
  const evenFix = scale ? `scale=${scale.w}:${scale.h},setsar=1,` : '';
  return `[0:v]${evenFix}format=yuv420p[base];${windowTitleStage({
    inLabel: '[base]', outLabel: '[v]', tintLabel: '[tint]', ...prepared, final: false,
  })}`;
}

/**
 * @param {{ videoPath: string, outPath: string, workDir: string, options: object, spec: object, signal?: AbortSignal, log?: Function }} job
 */
async function addTitleCard({ videoPath, outPath, workDir, options = {}, spec, signal, log = () => {} }) {
  const t0 = Date.now();
  const info = await probeVideo(videoPath);
  if (!info.width || !info.height) throw new Error('Could not read your video. Check it is a valid video file.');
  const plan = planTitleCard({ videoSec: info.duration, startSec: options.startSec, endSec: options.endSec });
  const even = { w: info.width - (info.width % 2), h: info.height - (info.height % 2) };
  const scale = even.w !== info.width || even.h !== info.height ? even : null;
  const fpsParts = String(info.fps || '30/1').split('/').map(Number);
  const fps = clamp(fpsParts[1] > 0 ? fpsParts[0] / fpsParts[1] : (fpsParts[0] || 30), 1, 60);

  const prepared = await prepareWindowTitle({ spec, startSec: plan.start, endSec: plan.end, size: { ...even, fps }, workDir });
  log(`card ${plan.start.toFixed(1)}s-${plan.end.toFixed(1)}s on a ${info.duration.toFixed(1)}s video ${even.w}x${even.h}@${fps.toFixed(0)}, fade in ${prepared.timing.fadeIn.toFixed(1)}s out ${prepared.timing.fadeOut.toFixed(1)}s`);

  const argsFor = (p) => {
    const args = ['-y', '-i', videoPath, '-filter_complex', buildTitleCardGraph({ prepared: p, scale }), '-map', '[v]'];
    if (info.hasAudio) args.push('-map', '0:a', '-c:a', 'copy'); // the soundtrack untouched
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath);
    return args;
  };
  try {
    await execFileAsync(FFMPEG, argsFor(prepared), 900000, { signal });
  } catch (err) {
    // Only the smooth tint fade needs an unusual filter chain. If it is rejected, still deliver the card with the tint switching on/off at once.
    const smooth = prepared.dimPct > 0 && (prepared.timing.fadeIn > 0 || prepared.timing.fadeOut > 0);
    if (!smooth || err.killed || err.name === 'AbortError' || signal?.aborted) throw err;
    log('smooth tint rejected, retrying with an instant tint');
    await execFileAsync(FFMPEG, argsFor({ ...prepared, timing: { ...prepared.timing, fadeIn: 0, fadeOut: 0 } }), 900000, { signal });
  }
  log(`encoded after ${Math.round((Date.now() - t0) / 1000)}s`);
  return plan;
}

module.exports = { planTitleCard, buildTitleCardGraph, addTitleCard, MIN_SECONDS };
