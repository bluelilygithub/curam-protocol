'use strict';

// Clean-up recipes for Video Tools (added 2026-11-17). The techniques follow the ffmpeg-skill project
// (github.com/kajisho5/ffmpeg-skill, MIT), rewritten on Vault's own ffmpeg helpers rather than shipping its Python scripts:
//
//   - HDR phone video to normal colour (iPhones record HDR by default; without this every re-encode came out grey and washed out)
//   - Remove silences (cut the pauses out of a talking video)
//   - Stabilise (vidstab, two passes; falls back to the simpler deshake filter)
//   - Reduce grain (hqdn3d, optional hiss reduction with afftdn)
//   - Remove logo (delogo over a box the person draws)
//   - Exact cut that only re-encodes the two ends (used by Clip / trim's "keep original quality")
//
// Tests: node server/services/videoCleanup.test.js

const fs = require('fs/promises');
const path = require('path');
const { FFMPEG, execFileAsync, probeVideo, escapeFilterPath } = require('./videoFfmpeg');

const FFPROBE = process.env.LOCAL_FFPROBE_COMMAND || 'ffprobe';

function log() {
  try { return require('../middleware/requestContext').getLogger(); } catch { return console; }
}

function userError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// ---------------------------------------------------------------------------------------------------------------------
// Which optional filters this ffmpeg has. Debian's ffmpeg (the server image) has all of them; a minimal local build may not,
// so every tool checks and either falls back or says plainly what is missing.
// ---------------------------------------------------------------------------------------------------------------------

let filterCache = null;

function parseFilterList(text) {
  const names = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*[A-Z.|]{2,3}\s+([a-z0-9_]+)\s/);
    if (m) names.add(m[1]);
  }
  return {
    tonemap: names.has('zscale') && names.has('tonemap'),
    vidstab: names.has('vidstabdetect') && names.has('vidstabtransform'),
    deshake: names.has('deshake'),
    hqdn3d: names.has('hqdn3d'),
    afftdn: names.has('afftdn'),
    delogo: names.has('delogo'),
    silencedetect: names.has('silencedetect'),
  };
}

async function ffmpegFilters() {
  if (filterCache) return filterCache;
  try {
    const { stdout } = await execFileAsync(FFMPEG, ['-hide_banner', '-filters'], 15000);
    filterCache = parseFilterList(stdout);
    return filterCache;
  } catch {
    return parseFilterList(''); // not cached: ffmpeg may come back
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// HDR to normal colour
// ---------------------------------------------------------------------------------------------------------------------

const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);

function isHdr(probe) {
  return HDR_TRANSFERS.has(String(probe?.colorTransfer || '').toLowerCase());
}

/**
 * The tone-mapping chain. mobius keeps normal-brightness colours as they are and only squeezes the very bright highlights,
 * which matched the original picture best in a side-by-side test (hable came out darker). The input transfer, primaries and
 * matrix are stated rather than trusted from each frame, because phone files do not always tag every frame.
 */
// The long side is capped at 1920 first: tone-mapping 4K ran at a third of real time on 8 cores (a 40-second 4K phone clip
// would take minutes before the actual tool even starts, against a five-minute request limit); at 1080p it runs at real time.
const SDR_MAX_SIDE = 1920;

function tonemapFilter(probe) {
  const tin = String(probe?.colorTransfer || '').toLowerCase() === 'arib-std-b67' ? 'arib-std-b67' : 'smpte2084';
  return [
    `scale='if(gte(iw,ih),min(${SDR_MAX_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${SDR_MAX_SIDE},ih))'`,
    `zscale=tin=${tin}:pin=bt2020:min=bt2020nc:t=linear:npl=100`,
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=mobius:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ].join(',');
}

/**
 * If the video is HDR, write a normal-colour copy next to it and return that path; otherwise return the path unchanged.
 * Near-lossless (CRF 14) because the tool that runs next encodes again. Sound is copied as it is.
 * @returns {Promise<{ path: string, converted: boolean, skipped?: string }>}
 */
async function toSdrIfHdr(inputPath, opts = {}) {
  let probe;
  try {
    probe = await probeVideo(inputPath);
  } catch {
    return { path: inputPath, converted: false };
  }
  if (!isHdr(probe)) return { path: inputPath, converted: false };
  const filters = await ffmpegFilters();
  if (!filters.tonemap) {
    log().warn('[videoCleanup] HDR video but this ffmpeg has no zscale/tonemap; colours will look washed out');
    return { path: inputPath, converted: false, skipped: 'no-tonemap' };
  }
  const outPath = path.join(path.dirname(inputPath), `${path.parse(inputPath).name}_sdr.mkv`);
  await execFileAsync(FFMPEG, [
    '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', tonemapFilter(probe),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'copy',
    outPath,
  ], undefined, opts.signal ? { signal: opts.signal } : {});
  return { path: outPath, converted: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Remove silences
// ---------------------------------------------------------------------------------------------------------------------

/** Read silencedetect's stderr into [{ start, end }]. A silence still open at the end runs to `durationSec`. */
function parseSilences(stderr, durationSec) {
  const out = [];
  let open = null;
  for (const line of String(stderr || '').split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[0-9.]+)/);
    if (s) { open = Math.max(0, Number(s[1])); continue; }
    const e = line.match(/silence_end:\s*([0-9.]+)/);
    if (e && open != null) {
      out.push({ start: open, end: Number(e[1]) });
      open = null;
    }
  }
  if (open != null && Number.isFinite(durationSec) && durationSec > open) out.push({ start: open, end: durationSec });
  return out.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
}

/**
 * Turn the silences into the parts to KEEP. Each silence is shrunk by `padSec` at both ends so a little breath stays
 * around every word; a silence too short to shrink is left alone. Boundaries snap to the frame grid (1/fps) so the
 * picture and the sound keep exactly the same pieces and cannot drift apart.
 * @returns {{ keep: {start:number,end:number}[], removedSec: number, cuts: number }}
 */
function planKeepSegments(silences, durationSec, { padSec = 0.15, fps = 30 } = {}) {
  const snap = (t) => Math.round(t * fps) / fps;
  const dur = snap(durationSec);
  const cutsRaw = [];
  for (const s of silences) {
    const start = snap(s.start <= 0.001 ? 0 : s.start + padSec); // a pause at the very start goes entirely
    const end = snap(s.end >= durationSec - 0.001 ? dur : s.end - padSec); // and so does one at the very end
    if (end - start >= 1 / fps) cutsRaw.push({ start, end });
  }
  cutsRaw.sort((a, b) => a.start - b.start);
  const cuts = [];
  for (const c of cutsRaw) {
    const last = cuts[cuts.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else cuts.push({ ...c });
  }
  const keep = [];
  let t = 0;
  for (const c of cuts) {
    if (c.start > t) keep.push({ start: t, end: c.start });
    t = Math.max(t, c.end);
  }
  if (dur > t) keep.push({ start: t, end: dur });
  const kept = keep.reduce((sum, k) => sum + (k.end - k.start), 0);
  return { keep, removedSec: Math.max(0, Math.round((dur - kept) * 100) / 100), cuts: cuts.length };
}

/** A frame rate with a whole number of 48 kHz sound samples per frame, nearest to the source's. */
function gridFps(fpsStr) {
  let n = 30;
  const m = String(fpsStr || '').match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (m && Number(m[1]) > 0) n = Number(m[1]) / (Number(m[2]) || 1);
  const choices = [24, 25, 30, 48, 50, 60];
  return choices.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best), 30);
}

function selectExpr(keep) {
  return keep.map((k) => `gte(t\\,${k.start.toFixed(4)})*lt(t\\,${k.end.toFixed(4)})`).join('+');
}

const SILENCE_LEVELS = { gentle: -40, normal: -35, strong: -30 };
const MAX_KEEP_SEGMENTS = 600;

/**
 * Cut the pauses out of a video.
 * @param {{ level?: 'gentle'|'normal'|'strong', minPauseSec?: number, padSec?: number, crf?: number }} opts
 * @returns {Promise<{ removedSec: number, cuts: number, durationSec: number }>}
 */
async function removeSilences(inputPath, outputPath, opts = {}) {
  const probe = await probeVideo(inputPath);
  if (!probe.hasAudio) throw userError('This video has no sound, so there are no pauses to find.');
  const durationSec = Number(probe.duration) || 0;
  if (durationSec < 1) throw userError('This video is too short.');
  const noiseDb = SILENCE_LEVELS[opts.level] ?? SILENCE_LEVELS.normal;
  const minPauseSec = Math.min(5, Math.max(0.3, Number(opts.minPauseSec) || 0.6));
  const padSec = Math.min(0.5, Math.max(0, Number(opts.padSec ?? 0.15)));
  const crf = Math.min(35, Math.max(18, Number(opts.crf) || 20));

  const { stderr } = await execFileAsync(FFMPEG, [
    '-hide_banner', '-nostats', '-i', inputPath, '-map', '0:a:0', '-vn',
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minPauseSec}`, '-f', 'null', '-',
  ]);
  const fps = gridFps(probe.fps);
  const plan = planKeepSegments(parseSilences(stderr, durationSec), durationSec, { padSec, fps });
  if (!plan.cuts || plan.removedSec < 0.1) {
    throw userError('No pauses found at this setting. Try "More" or a shorter pause length.');
  }
  if (!plan.keep.length) throw userError('The whole video counts as a pause at this setting. Try "Less".');
  if (plan.keep.length > MAX_KEEP_SEGMENTS) {
    throw userError(`That would make ${plan.keep.length} cuts. Choose a longer pause length so fewer, longer pauses are cut.`);
  }

  const expr = selectExpr(plan.keep);
  const samplesPerFrame = 48000 / fps;
  const graph = [
    `[0:v:0]setpts=PTS-STARTPTS,fps=${fps},select='${expr}',setpts=N/FRAME_RATE/TB,format=yuv420p[v]`,
    `[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,asetnsamples=n=${samplesPerFrame}:p=0,aselect='${expr}',asetpts=N/SR/TB[a]`,
  ].join(';');
  await execFileAsync(FFMPEG, [
    '-y', '-i', inputPath, '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', String(crf),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath,
  ]);
  return { removedSec: plan.removedSec, cuts: plan.cuts, durationSec };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stabilise
// ---------------------------------------------------------------------------------------------------------------------

const STABILIZE_LEVELS = {
  gentle: { shakiness: 4, smoothing: 10, deshake: 'deshake=rx=16:ry=16' },
  normal: { shakiness: 6, smoothing: 20, deshake: 'deshake=rx=32:ry=32' },
  strong: { shakiness: 9, smoothing: 40, deshake: 'deshake=rx=64:ry=64' },
};

/**
 * Steady a shaky video. vidstab looks at the whole video first (pass 1), then moves each frame against the shake and
 * zooms in just enough to hide the moving edges (pass 2). Without vidstab, deshake does a simpler single pass.
 * @returns {Promise<{ method: 'vidstab'|'deshake' }>}
 */
async function stabilizeVideo(inputPath, outputPath, opts = {}) {
  const level = STABILIZE_LEVELS[opts.strength] || STABILIZE_LEVELS.normal;
  const crf = Math.min(35, Math.max(18, Number(opts.crf) || 20));
  const probe = await probeVideo(inputPath);
  const filters = await ffmpegFilters();
  const audioArgs = probe.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k'] : [];
  const encode = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', String(crf)];

  if (filters.vidstab) {
    const trf = path.join(path.dirname(outputPath), 'stabilize.trf');
    const trfArg = escapeFilterPath(trf);
    await execFileAsync(FFMPEG, [
      '-y', '-i', inputPath, '-map', '0:v:0',
      '-vf', `vidstabdetect=shakiness=${level.shakiness}:accuracy=15:result='${trfArg}'`, '-f', 'null', '-',
    ]);
    await execFileAsync(FFMPEG, [
      '-y', '-i', inputPath, '-map', '0:v:0', ...audioArgs,
      '-vf', `vidstabtransform=input='${trfArg}':smoothing=${level.smoothing}:optzoom=1:interpol=bicubic,unsharp=5:5:0.6:3:3:0.3,format=yuv420p`,
      ...encode, '-movflags', '+faststart', outputPath,
    ]);
    await fs.rm(trf, { force: true }).catch(() => {});
    return { method: 'vidstab' };
  }
  if (!filters.deshake) throw userError('Stabilise is not available on this server (its video program has no stabilising filter).');
  await execFileAsync(FFMPEG, [
    '-y', '-i', inputPath, '-map', '0:v:0', ...audioArgs,
    '-vf', `${level.deshake},format=yuv420p`, ...encode, '-movflags', '+faststart', outputPath,
  ]);
  return { method: 'deshake' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reduce grain
// ---------------------------------------------------------------------------------------------------------------------

// Measured on 1080p video with added grain (picture match to the clean original, higher is better; grainy = 31.9 dB):
// 4:3:6:4.5 = 32.6, 7:5:10:7.5 = 35.9, 10:8:15:12 = 39.1. nlmeans reached 42.5 but ran at 1/8 of real time, too slow here.
// The ffmpeg default (4:3:6:4.5) barely changed anything, so it is the lightest step.
const DENOISE_LEVELS = {
  light: 'hqdn3d=4:3:6:4.5',
  medium: 'hqdn3d=7:5:10:7.5',
  strong: 'hqdn3d=10:8:15:12',
};

/**
 * Smooth out grain and speckle (low light, high zoom). `hiss` also lowers steady background hiss in the sound.
 * @param {{ strength?: 'light'|'medium'|'strong', hiss?: boolean, crf?: number }} opts
 */
async function denoiseVideo(inputPath, outputPath, opts = {}) {
  const vf = DENOISE_LEVELS[opts.strength] || DENOISE_LEVELS.medium;
  const crf = Math.min(35, Math.max(18, Number(opts.crf) || 20));
  const probe = await probeVideo(inputPath);
  const filters = await ffmpegFilters();
  if (!filters.hqdn3d) throw userError('Reduce grain is not available on this server.');
  const args = ['-y', '-i', inputPath, '-map', '0:v:0', '-vf', `${vf},format=yuv420p`];
  if (probe.hasAudio) {
    args.push('-map', '0:a:0');
    if (opts.hiss && filters.afftdn) args.push('-af', 'afftdn=nf=-25');
    args.push('-c:a', 'aac', '-b:a', '192k');
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', String(crf), '-movflags', '+faststart', outputPath);
  await execFileAsync(FFMPEG, args);
  return { hiss: Boolean(opts.hiss && filters.afftdn && probe.hasAudio) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Remove logo
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Turn a box given as fractions of the picture (0-1, as drawn on the page) into delogo's pixel box. delogo needs the box
 * to stay at least one pixel inside the picture, so it is clamped there. Width/height are the size as SHOWN (a phone video
 * stored sideways with a turn flag is turned before the filter runs).
 */
function logoBox(box, width, height) {
  const W = Math.max(8, Math.round(Number(width) || 0));
  const H = Math.max(8, Math.round(Number(height) || 0));
  const f = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  let x = Math.round(f(box?.x) * W);
  let y = Math.round(f(box?.y) * H);
  let w = Math.round(f(box?.w) * W);
  let h = Math.round(f(box?.h) * H);
  x = Math.min(Math.max(1, x), W - 5);
  y = Math.min(Math.max(1, y), H - 5);
  w = Math.max(4, Math.min(w, W - 1 - x));
  h = Math.max(4, Math.min(h, H - 1 - y));
  return { x, y, w, h };
}

/**
 * Fill a fixed box (an old logo, a date stamp, a channel bug) with the picture around it. Works for a box that does not
 * move. The person's own footage only: the page says so.
 * @param {{ box: {x,y,w,h} (fractions 0-1), crf?: number }} opts
 */
async function removeLogo(inputPath, outputPath, opts = {}) {
  const crf = Math.min(35, Math.max(18, Number(opts.crf) || 20));
  const b = opts.box || {};
  if (!(Number(b.w) > 0.003 && Number(b.h) > 0.003)) throw userError('Draw a box around the logo first.');
  if (Number(b.w) * Number(b.h) > 0.25) throw userError('That box covers more than a quarter of the picture. Draw it just around the logo.');
  const filters = await ffmpegFilters();
  if (!filters.delogo) throw userError('Remove logo is not available on this server.');
  const probe = await probeVideo(inputPath);
  const turned = probe.rotation === 90 || probe.rotation === 270;
  const { x, y, w, h } = logoBox(b, turned ? probe.height : probe.width, turned ? probe.width : probe.height);
  const args = ['-y', '-i', inputPath, '-map', '0:v:0', '-vf', `delogo=x=${x}:y=${y}:w=${w}:h=${h},format=yuv420p`];
  if (probe.hasAudio) args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', String(crf), '-movflags', '+faststart', outputPath);
  await execFileAsync(FFMPEG, args);
  return { box: { x, y, w, h } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exact cut that keeps the original quality ("smart cut")
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Packet times (seconds) of the video between two times, read from the packet list (no decoding, so it is quick).
 * `keys` are the keyframes; `all` is every packet, used to copy an exact number of frames.
 */
async function packetTimes(inputPath, fromSec, toSec) {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-read_intervals', `${Math.max(0, fromSec - 1)}%${toSec + 1}`,
    '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', inputPath,
  ], 60000);
  const rows = String(stdout).split(/\r?\n/).map((l) => l.split(',')).filter((p) => p.length >= 2 && Number.isFinite(Number(p[0])) && p[0] !== '');
  const all = rows.map((p) => Number(p[0])).sort((a, b) => a - b);
  const keys = rows.filter((p) => p[1].includes('K')).map((p) => Number(p[0])).sort((a, b) => a - b);
  return { all, keys };
}

/**
 * Decide whether a smart cut is worth it: the middle (keyframe to keyframe) must be long enough that copying it saves time,
 * and the file must be a kind whose copied middle can be joined to newly encoded ends (plain H.264, 8-bit, not turned).
 * @returns {{ ok: true, k1: number, k2: number } | { ok: false, reason: string }}
 */
function planSmartCut(probe, keyframes, startSec, endSec, { minMiddleSec = 8, allPackets = null } = {}) {
  if (String(probe?.codec || '') !== 'h264') return { ok: false, reason: 'not-h264' };
  if (probe?.pixFmt && probe.pixFmt !== 'yuv420p' && probe.pixFmt !== 'yuvj420p') return { ok: false, reason: 'pix-fmt' };
  if (probe?.rotation) return { ok: false, reason: 'rotated' };
  if (isHdr(probe)) return { ok: false, reason: 'hdr' };
  const eps = 0.0005;
  const k1 = keyframes.find((k) => k >= startSec - eps);
  const k2 = [...keyframes].reverse().find((k) => k <= endSec + eps);
  if (k1 == null || k2 == null || k2 - k1 < minMiddleSec) return { ok: false, reason: 'middle-too-short' };
  // the copied middle is exactly the frames from k1 up to (not including) k2; with closed groups of pictures these are also
  // the first `middleFrames` packets in file order, so copying that many packets stops cleanly before k2
  const middleFrames = allPackets ? allPackets.filter((t) => t >= k1 - eps && t < k2 - eps).length : 0;
  if (allPackets && !middleFrames) return { ok: false, reason: 'no-frames' };
  return { ok: true, k1, k2, middleFrames };
}

/**
 * Cut [startSec, endSec) on the exact frame, re-encoding only the bit before the first keyframe and the bit after the last
 * one; the middle is copied untouched (no quality loss, and much faster than re-encoding it). The sound is re-encoded
 * across the whole range so it has no seams. The result is checked by decoding it; on any problem returns false and the
 * caller falls back to the plain method.
 * @returns {Promise<boolean>} true when the smart cut was written to outputPath
 */
async function smartCut(inputPath, outputPath, { startSec, endSec }) {
  let probe;
  try { probe = await probeVideo(inputPath); } catch { return false; }
  const end = endSec != null && Number.isFinite(Number(endSec)) ? Number(endSec) : Number(probe.duration);
  const start = Math.max(0, Number(startSec) || 0);
  if (!(end > start)) return false;
  let packets;
  try { packets = await packetTimes(inputPath, start, end); } catch { return false; }
  const plan = planSmartCut(probe, packets.keys, start, end, { allPackets: packets.all });
  if (!plan.ok) {
    log().info({ reason: plan.reason }, '[videoCleanup] smart cut not used');
    return false;
  }
  const dir = path.dirname(outputPath);
  const part = (n) => path.join(dir, `smart_${n}.ts`);
  const encodeEnd = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '16', '-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts'];
  const parts = [];
  try {
    if (plan.k1 - start > 0.01) {
      await execFileAsync(FFMPEG, ['-y', '-ss', String(start), '-i', inputPath, '-t', (plan.k1 - start).toFixed(4), '-map', '0:v:0', '-an', ...encodeEnd, part('head')]);
      parts.push(part('head'));
    }
    await execFileAsync(FFMPEG, ['-y', '-ss', String(plan.k1), '-i', inputPath, '-map', '0:v:0', '-an', '-frames:v', String(plan.middleFrames), '-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts', part('mid')]);
    parts.push(part('mid'));
    if (end - plan.k2 > 0.01) {
      await execFileAsync(FFMPEG, ['-y', '-ss', String(plan.k2), '-i', inputPath, '-t', (end - plan.k2).toFixed(4), '-map', '0:v:0', '-an', ...encodeEnd, part('tail')]);
      parts.push(part('tail'));
    }
    const list = path.join(dir, 'smart_list.txt');
    await fs.writeFile(list, parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    const videoOnly = path.join(dir, 'smart_video.mp4');
    await execFileAsync(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', videoOnly]);
    const muxArgs = ['-y', '-i', videoOnly];
    if (probe.hasAudio) {
      muxArgs.push('-ss', String(start), '-t', (end - start).toFixed(4), '-i', inputPath, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '256k');
    } else {
      muxArgs.push('-map', '0:v:0');
    }
    muxArgs.push('-c:v', 'copy', '-movflags', '+faststart', outputPath);
    await execFileAsync(FFMPEG, muxArgs);

    // Check: right length (within about a frame and a half), and it decodes from end to end without errors.
    const out = await probeVideo(outputPath);
    const fps = (() => { const m = String(probe.fps || '').match(/^(\d+)\/(\d+)$/); return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : 30; })();
    const tolerance = Math.max(0.06, 1.5 / fps);
    if (Math.abs((Number(out.duration) || 0) - (end - start)) > tolerance) throw new Error(`length ${out.duration} vs ${end - start}`);
    const { stderr } = await execFileAsync(FFMPEG, ['-v', 'error', '-i', outputPath, '-map', '0:v:0', '-f', 'null', '-']);
    if (String(stderr || '').trim()) throw new Error(`decode errors: ${String(stderr).slice(0, 200)}`);
    return true;
  } catch (err) {
    log().warn({ err: err?.message }, '[videoCleanup] smart cut failed; falling back');
    await fs.rm(outputPath, { force: true }).catch(() => {});
    return false;
  }
}

module.exports = {
  ffmpegFilters,
  parseFilterList,
  isHdr,
  tonemapFilter,
  toSdrIfHdr,
  parseSilences,
  planKeepSegments,
  gridFps,
  selectExpr,
  removeSilences,
  SILENCE_LEVELS,
  stabilizeVideo,
  STABILIZE_LEVELS,
  denoiseVideo,
  DENOISE_LEVELS,
  logoBox,
  removeLogo,
  packetTimes,
  planSmartCut,
  smartCut,
};
