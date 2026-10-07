'use strict';

// Join videos with per-clip effects and per-join transitions.
//
//   1. Every join is a cut AND no clip has any effect  -> the existing joinVideos() path, untouched.
//   2. Otherwise each clip goes through the PREPARE stage (effects, then size / fps / audio
//      normalisation — so transitions act on the final look and mixed sources can't break them).
//   3. All joins cut (but some clip has effects)       -> prepared clips are stream-copy concatenated.
//   4. Any blend or dip                                -> one filter graph over the prepared clips.

const fs = require('fs/promises');
const path = require('path');
const ff = require('../videoFfmpeg');
const { TRANSITIONS } = require('./transitions');
const { buildClipChain, hasClipEffects } = require('./clipEffects');
const { buildJoinGraph } = require('./joinGraph');

const FPS = 30;

function evenDim(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 2) return 2;
  return v % 2 ? v - 1 : v;
}

/** Same canvas rule as the existing join: widest source (capped), first clip's aspect ratio. */
function targetSize(probes, maxWidth) {
  let w = Math.min(maxWidth, Math.max(...probes.map((p) => p.width || 1280)));
  if (!Number.isFinite(w) || w < 160) w = maxWidth;
  w = evenDim(w);
  let h = probes[0]?.height && probes[0]?.width
    ? evenDim((probes[0].height / probes[0].width) * w)
    : evenDim((w * 9) / 16);
  if (h < 120) h = 720;
  return { width: w, height: h };
}

function allCuts(joins) {
  return joins.every((j) => TRANSITIONS[j.type]?.kind === 'cut');
}

/**
 * @param {string[]} inputPaths  clip files in PLAY order
 * @param {string} outputPath
 * @param {{ clips: object[], joins: object[] }} plan  clips[i] = effects for inputPaths[i] ({} = none),
 *   joins[j] = normalised join between clip j and j+1
 * @param {{ maxWidth?: number, crf?: number }} [opts]
 * @param {{ joinLegacy?: Function, exec?: Function, probe?: Function }} [deps]  test seams
 */
async function joinClips(inputPaths, outputPath, plan, opts = {}, deps = {}) {
  const exec = deps.exec || ff.execFileAsync;
  const probe = deps.probe || ff.probeVideo;
  const joinLegacy = deps.joinLegacy || ff.joinVideosWithOptionalCrossfade;

  if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
    throw new Error('At least two video files are required to join');
  }
  const n = inputPaths.length;
  const clips = Array.from({ length: n }, (_, i) => plan?.clips?.[i] || {});
  const joins = plan?.joins || [];
  if (joins.length !== n - 1) throw new Error('Expected one join per gap between clips');

  const maxWidth = opts.maxWidth != null && Number.isFinite(opts.maxWidth)
    ? Math.max(160, Math.min(3840, Math.round(opts.maxWidth)))
    : 1280;
  const crf = opts.crf != null && Number.isFinite(opts.crf)
    ? Math.min(35, Math.max(18, Math.round(opts.crf)))
    : 23;

  // (1) Plain join: exactly the existing behaviour.
  if (allCuts(joins) && !clips.some(hasClipEffects)) {
    await joinLegacy(inputPaths, outputPath, { maxWidth, crf, crossfadeSec: 0 });
    return { path: 'legacy' };
  }

  // (1b) One blend type and length for every join, no clip effects, and a blend the original
  // crossfade code knows: keep using it, so existing plans give exactly the output they used to.
  const first = joins[0];
  const firstDef = TRANSITIONS[first.type];
  if (!clips.some(hasClipEffects)
    && firstDef.kind === 'overlap'
    && ff.XFADE_TRANSITIONS.has(firstDef.xfade)
    && joins.every((j) => j.type === first.type && j.duration === first.duration)) {
    await joinLegacy(inputPaths, outputPath, {
      maxWidth, crf, crossfadeSec: first.duration, transition: firstDef.xfade,
    });
    return { path: 'legacy-crossfade' };
  }

  // (2) Prepare stage.
  const probes = [];
  for (const p of inputPaths) probes.push(await probe(p));
  const { width, height } = targetSize(probes, maxWidth);
  const dir = path.dirname(outputPath);
  const prepared = [];
  const durations = [];

  for (let i = 0; i < n; i += 1) {
    const info = probes[i];
    const srcDur = Math.max(0.1, Number(info.duration) || 1);
    const chain = buildClipChain(clips[i], srcDur);
    const vf = [
      ...chain.v,
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      'setsar=1',
      `fps=${FPS}`,
      'format=yuv420p',
    ].join(',');
    const outPath = path.join(dir, `join_prep_${i}.mp4`);
    const args = ['-y', '-i', inputPaths[i]];
    if (info.hasAudio) {
      args.push('-vf', vf);
      args.push('-af', [...chain.a, 'aresample=48000'].join(','));
    } else {
      // Silent stereo track so every prepared clip has audio.
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      args.push('-vf', vf, '-map', '0:v:0', '-map', '1:a:0', '-shortest');
    }
    args.push(
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      outPath,
    );
    await exec(ff.FFMPEG, args, 600000);
    prepared.push(outPath);
    durations.push(Math.max(0.1, Number((await probe(outPath)).duration) || chain.dur));
  }

  // (3) All cuts: stream-copy concat of the prepared clips.
  if (allCuts(joins)) {
    const listPath = path.join(dir, 'join_prep_concat.txt');
    await fs.writeFile(listPath, prepared.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    await exec(ff.FFMPEG, [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', '-movflags', '+faststart', outputPath,
    ], 300000);
    return { path: 'prepared-concat', durations };
  }

  // (4) Blends and dips.
  const graph = buildJoinGraph({ durations, joins, width, height, fps: FPS });
  await exec(ff.FFMPEG, [
    '-y',
    ...prepared.flatMap((p) => ['-i', p]),
    '-filter_complex', graph.filterComplex,
    '-map', graph.mapV, '-map', graph.mapA,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-movflags', '+faststart',
    outputPath,
  ], 900000);
  return { path: 'graph', durations, totalDuration: graph.totalDuration };
}

module.exports = { joinClips, allCuts, targetSize };
