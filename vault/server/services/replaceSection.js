'use strict';

// Replace a section: swap the PICTURE of one stretch of a video for a clip of exactly the same length.
//
// Deliberately narrow, so that nothing else has to change:
//   - the original soundtrack is copied untouched (music and voice run straight through with no seam);
//   - the finished video is exactly as long as the original, frame for frame;
//   - the replacement must match the section's length (within a tenth of a second, which is quietly fixed); a bigger difference is
//     refused with the exact amount to trim, and the person trims the clip first.
// Transitions in and out happen INSIDE the section (the first/last moments of the section blend the original picture and the new
// one), because the length may not change.
//
// planReplaceSection / buildReplaceGraph are pure and tested without ffmpeg (replaceSection.test.js).

const { execFileAsync, FFMPEG, probeVideo } = require('./videoFfmpeg');
const { TRANSITIONS, resolveTransitionType } = require('./videoJoin/transitions');

const TOLERANCE_SEC = 0.1;
const MIN_SECTION_SEC = 0.2;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v));
const r3 = (n) => Math.round(n * 1000) / 1000; // times to the millisecond, so 32 - 20 is 12 and not 12.000000000000002
const s1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

/** The ffmpeg xfade name for one of Join's transition ids, or null for a hard cut. */
function xfadeFor(type) {
  const def = TRANSITIONS[type];
  if (!def || def.kind === 'cut') return null;
  if (def.kind === 'dip') return def.color === 'white' ? 'fadewhite' : 'fadeblack';
  return def.xfade || 'fade';
}

/** One edge of the section: { type, sec }. A hard cut has no length. */
function normalizeEdge(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const type = resolveTransitionType(src.type, 'cut');
  if (!xfadeFor(type)) return { type: 'cut', xfade: null, sec: 0 };
  return { type, xfade: xfadeFor(type), sec: clamp(num(src.sec, 0.5), 0.1, 3) };
}

/**
 * @param {{ origSec: number, replSec: number, startSec: number, endSec?: number, transitionIn?: object, transitionOut?: object }} input
 * @returns the section to replace, the length it ends up, and each edge's transition (clamped to fit inside the section)
 * @throws Error with a plain-worded message the person can act on
 */
function planReplaceSection({ origSec, replSec, startSec, endSec, transitionIn, transitionOut } = {}) {
  const orig = Number(origSec);
  const repl = Number(replSec);
  if (!(orig > 0)) throw new Error('Could not read how long your video is. Check it is a valid video file.');
  if (!(repl > 0)) throw new Error('Could not read how long the replacement clip is. Check it is a valid video file.');

  const start = r3(Math.max(0, num(startSec, 0)));
  const wantedEnd = endSec === undefined || endSec === null || endSec === '' ? null : Number(endSec);
  const length = r3(wantedEnd !== null && Number.isFinite(wantedEnd) ? wantedEnd - start : repl);
  if (!(length >= MIN_SECTION_SEC)) throw new Error('The section is too short. Set the end after the start (at least a fifth of a second).');
  if (start + length > orig + TOLERANCE_SEC) {
    throw new Error(`The section runs past the end of your video: it would finish at ${s1(start + length)} s but the video is only ${s1(orig)} s long.`);
  }

  const diff = r3(repl - length);
  if (Math.abs(diff) > TOLERANCE_SEC) {
    throw new Error(diff > 0
      ? `Your clip is ${s1(diff)} s too long for this section (the section is ${s1(length)} s, the clip is ${s1(repl)} s). Trim ${s1(diff)} s off the clip in Clip / trim, then try again.`
      : `Your clip is ${s1(-diff)} s too short for this section (the section is ${s1(length)} s, the clip is ${s1(repl)} s). Use a clip that is ${s1(length)} s long, or move the section's end earlier by ${s1(-diff)} s.`);
  }

  const end = r3(Math.min(start + length, orig));
  const L = r3(end - start);

  // Each edge's blend lives inside the section; together they may not use more than the whole section.
  const tin = normalizeEdge(transitionIn);
  const tout = normalizeEdge(transitionOut);
  let din = Math.min(tin.sec, L);
  let dout = Math.min(tout.sec, L);
  if (din + dout > L) {
    const k = L / (din + dout);
    din *= k;
    dout *= k;
  }
  return {
    origSec: orig,
    start,
    end,
    length: L,
    din: tin.xfade ? din : 0,
    dout: tout.xfade ? dout : 0,
    xfadeIn: tin.xfade,
    xfadeOut: tout.xfade,
    typeIn: tin.type,
    typeOut: tout.type,
    adjustedBySec: Math.abs(diff) > 0.005 ? diff : 0, // a tiny mismatch that was fixed for them
  };
}

/**
 * The picture graph. Inputs: [0:v] the original, [1:v] the replacement. Output: [v], the same number of frames as the original.
 * Built on whole frames so the finished video stays in step with the untouched soundtrack (no drift from rounding).
 *
 *   original:  | before | section (only used under the blends) | after |
 *   result:    | before | blend-in | new clip | blend-out | after |
 */
function buildReplaceGraph(plan, { width, height, fps, fit = 'fill' }) {
  const F = fps;
  const w = width - (width % 2);
  const h = height - (height % 2);
  const nStart = Math.round(plan.start * F);
  const nEnd = Math.max(nStart + 1, Math.round(plan.end * F));
  const nLen = nEnd - nStart;
  const nIn = plan.xfadeIn ? Math.min(nLen, Math.max(1, Math.round(plan.din * F))) : 0;
  const nOut = plan.xfadeOut ? Math.min(nLen - nIn, Math.max(1, Math.round(plan.dout * F))) : 0;
  const nMid = nLen - nIn - nOut;
  const hasBefore = nStart > 0;
  const totalFrames = Math.round(plan.origSec * F);
  const hasAfter = nEnd < totalFrames - 1; // a single leftover frame is rounding, not a real tail
  const dur = (n) => (n / F).toFixed(6);

  const trim = (inLabel, a, b, outLabel) => `${inLabel}trim=start_frame=${a}:end_frame=${b},setpts=PTS-STARTPTS${outLabel}`;
  const fan = (inLabel, labels) => (labels.length === 1 ? `${inLabel}null${labels[0]}` : `${inLabel}split=${labels.length}${labels.join('')}`);

  const fitFilter = fit === 'fit'
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;

  const g = [];
  // original: only the parts we still need
  const oNeeds = [];
  if (hasBefore) oNeeds.push('before');
  if (nIn) oNeeds.push('bIn');
  if (nOut) oNeeds.push('bOut');
  if (hasAfter) oNeeds.push('after');
  if (oNeeds.length) {
    g.push(`[0:v]fps=${F},setsar=1,format=yuv420p,${fan('', oNeeds.map((n) => `[o_${n}]`))}`);
  }
  // replacement: scaled to the original's picture, same frame rate, held a moment longer than needed so a clip a hair short still fills
  const rNeeds = [];
  if (nIn) rNeeds.push('in');
  if (nMid > 0) rNeeds.push('mid');
  if (nOut) rNeeds.push('out');
  g.push(`[1:v]${fitFilter},setsar=1,fps=${F},format=yuv420p,tpad=stop_mode=clone:stop_duration=0.5,`
    + `trim=start_frame=0:end_frame=${nLen},setpts=PTS-STARTPTS,${fan('', rNeeds.map((n) => `[r_${n}]`))}`);

  const seq = [];
  if (hasBefore) { g.push(trim('[o_before]', 0, nStart, '[A]')); seq.push('[A]'); }
  if (nIn) {
    g.push(trim('[o_bIn]', nStart, nStart + nIn, '[BI]'));
    g.push(trim('[r_in]', 0, nIn, '[RI]'));
    g.push(`[BI][RI]xfade=transition=${plan.xfadeIn}:duration=${dur(nIn)}:offset=0[IN]`);
    seq.push('[IN]');
  }
  if (nMid > 0) { g.push(trim('[r_mid]', nIn, nIn + nMid, '[MID]')); seq.push('[MID]'); }
  if (nOut) {
    g.push(trim('[r_out]', nIn + nMid, nLen, '[RO]'));
    g.push(trim('[o_bOut]', nEnd - nOut, nEnd, '[BO]'));
    g.push(`[RO][BO]xfade=transition=${plan.xfadeOut}:duration=${dur(nOut)}:offset=0[OUT]`);
    seq.push('[OUT]');
  }
  if (hasAfter) { g.push(`[o_after]trim=start_frame=${nEnd},setpts=PTS-STARTPTS[C]`); seq.push('[C]'); }

  g.push(seq.length === 1 ? `${seq[0]}null[v]` : `${seq.join('')}concat=n=${seq.length}:v=1:a=0[v]`);
  return { graph: g.join(';'), frames: { before: nStart, blendIn: nIn, middle: nMid, blendOut: nOut, section: nLen, total: totalFrames } };
}

function parseFps(raw) {
  const parts = String(raw || '30/1').split('/').map(Number);
  const f = parts[1] > 0 ? parts[0] / parts[1] : (parts[0] || 30);
  return clamp(f, 1, 120);
}

/**
 * @param {{ videoPath: string, replacementPath: string, outPath: string, options?: object, signal?: AbortSignal, log?: Function }} job
 */
async function replaceSection({ videoPath, replacementPath, outPath, options = {}, signal, log = () => {} }) {
  const t0 = Date.now();
  const orig = await probeVideo(videoPath);
  const repl = await probeVideo(replacementPath);
  if (!orig.width || !orig.height) throw new Error('Could not read your video. Check it is a valid video file.');
  const plan = planReplaceSection({
    origSec: orig.duration,
    replSec: repl.duration,
    startSec: options.startSec,
    endSec: options.endSec,
    transitionIn: options.transitionIn,
    transitionOut: options.transitionOut,
  });
  const fps = parseFps(orig.fps);
  const { graph, frames } = buildReplaceGraph(plan, { width: orig.width, height: orig.height, fps, fit: options.fit === 'fit' ? 'fit' : 'fill' });
  log(`replacing ${plan.start.toFixed(1)}s-${plan.end.toFixed(1)}s of a ${orig.duration.toFixed(1)}s video ${orig.width}x${orig.height}@${fps.toFixed(0)}; in=${plan.typeIn}:${plan.din.toFixed(2)}s out=${plan.typeOut}:${plan.dout.toFixed(2)}s; ${frames.total} frames`);
  const args = ['-y', '-i', videoPath, '-i', replacementPath, '-filter_complex', graph, '-map', '[v]'];
  if (orig.hasAudio) args.push('-map', '0:a', '-c:a', 'copy'); // the original soundtrack, byte for byte
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath);
  await execFileAsync(FFMPEG, args, 900000, { signal });
  log(`encoded after ${Math.round((Date.now() - t0) / 1000)}s`);
  return plan;
}

module.exports = { planReplaceSection, buildReplaceGraph, normalizeEdge, xfadeFor, replaceSection, TOLERANCE_SEC };
