'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { writeFontToDir } = require('./googleFonts');

const FFMPEG = process.env.LOCAL_FFMPEG_COMMAND || 'ffmpeg';
const FFPROBE = process.env.LOCAL_FFPROBE_COMMAND || 'ffprobe';
const MAX_VIDEO_BYTES = Number(process.env.VIDEO_MAX_UPLOAD_MB || 80) * 1024 * 1024;

// Default covers a long join/convert of near-cap uploads; probes pass their own short timeout.
const DEFAULT_EXEC_TIMEOUT_MS = Number(process.env.VIDEO_FFMPEG_TIMEOUT_MS) || 480000;

function execFileAsync(cmd, args, timeout = DEFAULT_EXEC_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function checkFfmpeg() {
  try {
    await execFileAsync(FFMPEG, ['-version'], 10000);
    return true;
  } catch {
    return false;
  }
}

function extensionForMime(mime = '') {
  const m = String(mime).toLowerCase();
  if (m.includes('webm')) return '.webm';
  if (m.includes('quicktime') || m.includes('mov')) return '.mov';
  if (m.includes('matroska') || m.includes('mkv')) return '.mkv';
  return '.mp4';
}

async function probeVideo(filePath) {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const video = (data.streams || []).find((s) => s.codec_type === 'video');
  const audio = (data.streams || []).find((s) => s.codec_type === 'audio');
  return {
    duration: Number(data.format?.duration) || null,
    size: Number(data.format?.size) || null,
    width: video?.width || null,
    height: video?.height || null,
    fps: video?.avg_frame_rate || null,
    codec: video?.codec_name || null,
    hasAudio: Boolean(audio),
    format: data.format?.format_name || null,
  };
}

async function clipVideo(inputPath, outputPath, { startSec, endSec }) {
  const start = Math.max(0, Number(startSec) || 0);
  const end = endSec != null && endSec !== '' ? Number(endSec) : null;
  const copyArgs = ['-y', '-ss', String(start), '-i', inputPath];
  if (end != null && Number.isFinite(end)) copyArgs.push('-to', String(end));
  copyArgs.push('-c', 'copy', '-avoid_negative_ts', '1', outputPath);
  try {
    await execFileAsync(FFMPEG, copyArgs);
  } catch {
    const enc = ['-y', '-ss', String(start), '-i', inputPath];
    if (end != null && Number.isFinite(end)) enc.push('-to', String(end));
    enc.push(
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      outputPath
    );
    await execFileAsync(FFMPEG, enc);
  }
}

async function convertVideo(inputPath, outputPath, { crf = 23, maxWidth } = {}) {
  const args = ['-y', '-i', inputPath];
  if (maxWidth) {
    args.push('-vf', `scale='min(${maxWidth},iw)':-2`);
  }
  args.push(
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    outputPath
  );
  await execFileAsync(FFMPEG, args);
}

/**
 * Concatenate multiple video files into one MP4.
 * Clips are normalized (resolution, fps, audio) then joined so mixed
 * codecs / sizes / missing-audio inputs still work.
 *
 * @param {string[]} inputPaths — ordered file paths
 * @param {string} outputPath
 * @param {{ maxWidth?: number, crf?: number }} [opts]
 */
async function joinVideos(inputPaths, outputPath, opts = {}) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
    throw new Error('At least two video files are required to join');
  }

  const maxWidth = opts.maxWidth != null && Number.isFinite(opts.maxWidth)
    ? Math.max(160, Math.min(3840, Math.round(opts.maxWidth)))
    : 1280;
  const crf = opts.crf != null && Number.isFinite(opts.crf)
    ? Math.min(35, Math.max(18, Math.round(opts.crf)))
    : 23;

  const probes = [];
  for (const p of inputPaths) {
    probes.push(await probeVideo(p));
  }

  // Target canvas: largest width among inputs (capped), keep 16:9-ish height from first clip.
  let targetW = Math.min(
    maxWidth,
    Math.max(...probes.map((p) => p.width || 1280))
  );
  if (!Number.isFinite(targetW) || targetW < 160) targetW = maxWidth;
  // Even dimensions required for yuv420p / libx264
  if (targetW % 2) targetW -= 1;

  let targetH = probes[0]?.height && probes[0]?.width
    ? Math.round((probes[0].height / probes[0].width) * targetW)
    : Math.round((targetW * 9) / 16);
  if (targetH % 2) targetH -= 1;
  if (targetH < 120) targetH = 720;

  const dir = path.dirname(outputPath);
  const normalized = [];

  for (let i = 0; i < inputPaths.length; i += 1) {
    const inputPath = inputPaths[i];
    const info = probes[i];
    const normPath = path.join(dir, `join_norm_${i}.mp4`);
    const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,`
      + `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;

    if (info.hasAudio) {
      await execFileAsync(FFMPEG, [
        '-y', '-i', inputPath,
        '-vf', vf,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart',
        normPath,
      ], 600000);
    } else {
      // Silent stereo track so concat always has audio on every segment
      await execFileAsync(FFMPEG, [
        '-y',
        '-i', inputPath,
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-vf', vf,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
        '-c:a', 'aac', '-b:a', '128k',
        '-map', '0:v:0', '-map', '1:a:0',
        '-shortest',
        '-movflags', '+faststart',
        normPath,
      ], 600000);
    }
    normalized.push(normPath);
  }

  const listPath = path.join(dir, 'join_concat.txt');
  const listBody = normalized
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(listPath, listBody, 'utf8');

  // Same codec/params after normalize → stream copy is safe and fast
  try {
    await execFileAsync(FFMPEG, [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', '-movflags', '+faststart',
      outputPath,
    ], 300000);
  } catch {
    await execFileAsync(FFMPEG, [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      outputPath,
    ], 600000);
  }
}

function evenDim(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 2) return 2;
  return v % 2 ? v - 1 : v;
}

const ASPECT_RATIOS = {
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '1:1': 1,
  '4:5': 4 / 5,
};

/**
 * Reframe to a target aspect ratio via center-crop (fill) or letterbox (pad).
 * @param {{ aspect?: string, mode?: 'crop'|'pad', maxHeight?: number, focus?: string, crf?: number }} [opts]
 */
async function reframeVideo(inputPath, outputPath, opts = {}) {
  const aspect = opts.aspect || '9:16';
  const mode = opts.mode === 'pad' ? 'pad' : 'crop';
  const focus = opts.focus || 'center';
  const maxHeight = Math.max(240, Math.min(2160, Number(opts.maxHeight) || 1920));
  const crf = Math.min(35, Math.max(18, Number(opts.crf) || 23));
  const ratio = ASPECT_RATIOS[aspect];
  if (!ratio) throw new Error(`Unsupported aspect "${aspect}" — use 9:16, 16:9, 1:1, or 4:5`);

  const probe = await probeVideo(inputPath);
  let th = evenDim(Math.min(maxHeight, probe.height || maxHeight));
  let tw = evenDim(th * ratio);
  // Prefer fitting the source's longer side for portrait targets from landscape
  if (probe.width && probe.height) {
    const srcRatio = probe.width / probe.height;
    if (mode === 'crop') {
      if (srcRatio > ratio) {
        th = evenDim(Math.min(maxHeight, probe.height));
        tw = evenDim(th * ratio);
      } else {
        tw = evenDim(Math.min(maxHeight * ratio * (16 / 9), probe.width || maxHeight));
        th = evenDim(tw / ratio);
        if (th > maxHeight) {
          th = evenDim(maxHeight);
          tw = evenDim(th * ratio);
        }
      }
    }
  }

  let vf;
  if (mode === 'pad') {
    vf = `scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
  } else {
    let cropX = '(iw-ow)/2';
    let cropY = '(ih-oh)/2';
    if (focus === 'top') cropY = '0';
    else if (focus === 'bottom') cropY = 'ih-oh';
    else if (focus === 'left') cropX = '0';
    else if (focus === 'right') cropX = 'iw-ow';
    vf = `scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}:${cropX}:${cropY},setsar=1,format=yuv420p`;
  }

  const hasAudio = (await probeVideo(inputPath)).hasAudio;
  const args = ['-y', '-i', inputPath, '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf)];
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k');
  else args.push('-an');
  args.push('-movflags', '+faststart', outputPath);
  await execFileAsync(FFMPEG, args, 600000);
}

/**
 * Mute soundtrack or replace with an external audio file.
 * @param {{ mode?: 'mute'|'replace', audioPath?: string }} [opts]
 */
async function muteOrReplaceAudio(inputPath, outputPath, opts = {}) {
  const mode = opts.mode === 'replace' ? 'replace' : 'mute';
  if (mode === 'mute') {
    try {
      await execFileAsync(FFMPEG, [
        '-y', '-i', inputPath, '-c:v', 'copy', '-an', '-movflags', '+faststart', outputPath,
      ]);
    } catch {
      await execFileAsync(FFMPEG, [
        '-y', '-i', inputPath,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-an', '-movflags', '+faststart', outputPath,
      ], 600000);
    }
    return;
  }
  if (!opts.audioPath) throw new Error('audioPath is required for replace mode');
  try {
    await execFileAsync(FFMPEG, [
      '-y', '-i', inputPath, '-i', opts.audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart', outputPath,
    ]);
  } catch {
    await execFileAsync(FFMPEG, [
      '-y', '-i', inputPath, '-i', opts.audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart', outputPath,
    ], 600000);
  }
}

function buildAtempoChain(speed) {
  const filters = [];
  let s = speed;
  while (s > 2.0 + 1e-9) {
    filters.push('atempo=2.0');
    s /= 2.0;
  }
  while (s < 0.5 - 1e-9) {
    filters.push('atempo=0.5');
    s /= 0.5;
  }
  filters.push(`atempo=${Number(s.toFixed(4))}`);
  return filters.join(',');
}

/**
 * Change playback speed (0.25×–4×). Audio tempo follows when present.
 * @param {{ speed?: number, crf?: number }} [opts]
 */
async function changeVideoSpeed(inputPath, outputPath, opts = {}) {
  const speed = Number(opts.speed);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error('speed must be between 0.25 and 4');
  }
  const crf = Math.min(35, Math.max(18, Number(opts.crf) || 23));
  const probe = await probeVideo(inputPath);
  const setpts = `setpts=${(1 / speed).toFixed(6)}*PTS`;

  if (probe.hasAudio) {
    const af = buildAtempoChain(speed);
    await execFileAsync(FFMPEG, [
      '-y', '-i', inputPath,
      '-filter_complex', `[0:v]${setpts},format=yuv420p[v];[0:a]${af}[a]`,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', outputPath,
    ], 600000);
  } else {
    await execFileAsync(FFMPEG, [
      '-y', '-i', inputPath,
      '-vf', `${setpts},format=yuv420p`,
      '-an',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
      '-movflags', '+faststart', outputPath,
    ], 600000);
  }
}

const OVERLAY_POSITIONS = {
  'top-left': { x: '40', y: '40' },
  'top-center': { x: '(W-w)/2', y: '40' },
  'top-right': { x: 'W-w-40', y: '40' },
  'center-left': { x: '40', y: '(H-h)/2' },
  center: { x: '(W-w)/2', y: '(H-h)/2' },
  'center-right': { x: 'W-w-40', y: '(H-h)/2' },
  'bottom-left': { x: '40', y: 'H-h-40' },
  'bottom-center': { x: '(W-w)/2', y: 'H-h-40' },
  'bottom-right': { x: 'W-w-40', y: 'H-h-40' },
};

/**
 * Overlay an image (logo/watermark) on video.
 * @param {{ position?: string, scalePct?: number, opacity?: number, crf?: number }} [opts]
 */
async function overlayImage(inputPath, imagePath, outputPath, opts = {}) {
  const position = opts.position || 'bottom-right';
  const scalePct = Math.min(80, Math.max(5, Number(opts.scalePct) || 20));
  const opacity = Math.min(1, Math.max(0.05, Number(opts.opacity) ?? 0.85));
  const crf = Math.min(35, Math.max(18, Number(opts.crf) || 23));
  const pos = OVERLAY_POSITIONS[position] || OVERLAY_POSITIONS['bottom-right'];
  const probe = await probeVideo(inputPath);
  const baseW = probe.width || 1280;
  const ovW = evenDim((baseW * scalePct) / 100);

  const fc = `[1:v]scale=${ovW}:-1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[ov];`
    + `[0:v][ov]overlay=x=${pos.x}:y=${pos.y}:format=auto[vout]`;

  const args = [
    '-y', '-i', inputPath, '-i', imagePath,
    '-filter_complex', fc,
    '-map', '[vout]',
  ];
  if (probe.hasAudio) args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', '128k');
  else args.push('-an');
  args.push(
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath
  );
  await execFileAsync(FFMPEG, args, 600000);
}

/**
 * Join with optional crossfade between clips.
 * When crossfadeSec > 0, uses xfade + acrossfade after normalize.
 */
// Allow-list: the name is interpolated into a filtergraph, so it must never come straight from a request.
const XFADE_TRANSITIONS = new Set([
  'fade', 'dissolve', 'fadeblack', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'zoomin',
]);

async function joinVideosWithOptionalCrossfade(inputPaths, outputPath, opts = {}) {
  const crossfadeSec = Math.max(0, Number(opts.crossfadeSec) || 0);
  const transition = XFADE_TRANSITIONS.has(opts.transition) ? opts.transition : 'fade';
  if (crossfadeSec <= 0) {
    return joinVideos(inputPaths, outputPath, opts);
  }
  if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
    throw new Error('At least two video files are required to join');
  }

  const maxWidth = opts.maxWidth != null && Number.isFinite(opts.maxWidth)
    ? Math.max(160, Math.min(3840, Math.round(opts.maxWidth)))
    : 1280;
  const crf = opts.crf != null && Number.isFinite(opts.crf)
    ? Math.min(35, Math.max(18, Math.round(opts.crf)))
    : 23;

  const probes = [];
  for (const p of inputPaths) probes.push(await probeVideo(p));

  let targetW = Math.min(maxWidth, Math.max(...probes.map((p) => p.width || 1280)));
  if (!Number.isFinite(targetW) || targetW < 160) targetW = maxWidth;
  targetW = evenDim(targetW);
  let targetH = probes[0]?.height && probes[0]?.width
    ? evenDim((probes[0].height / probes[0].width) * targetW)
    : evenDim((targetW * 9) / 16);
  if (targetH < 120) targetH = 720;

  const dir = path.dirname(outputPath);
  const normalized = [];
  const durations = [];

  for (let i = 0; i < inputPaths.length; i += 1) {
    const info = probes[i];
    const dur = Math.max(0.1, Number(info.duration) || 1);
    durations.push(dur);
    const normPath = path.join(dir, `xfade_norm_${i}.mp4`);
    const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,`
      + `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;

    if (info.hasAudio) {
      await execFileAsync(FFMPEG, [
        '-y', '-i', inputPaths[i],
        '-vf', vf,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
        normPath,
      ], 600000);
    } else {
      await execFileAsync(FFMPEG, [
        '-y', '-i', inputPaths[i],
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-vf', vf,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
        '-c:a', 'aac', '-b:a', '128k',
        '-map', '0:v:0', '-map', '1:a:0', '-shortest',
        normPath,
      ], 600000);
    }
    normalized.push(normPath);
  }

  // Cap crossfade so each clip still contributes content
  const minDur = Math.min(...durations);
  const fade = Math.min(crossfadeSec, Math.max(0.1, minDur / 2 - 0.05));

  const n = normalized.length;
  const inputs = normalized.flatMap((p) => ['-i', p]);
  const vParts = [];
  const aParts = [];
  let vPrev = '[0:v]';
  let aPrev = '[0:a]';
  let offset = durations[0] - fade;

  for (let i = 1; i < n; i += 1) {
    const vOut = i === n - 1 ? '[vout]' : `[v${i}]`;
    const aOut = i === n - 1 ? '[aout]' : `[a${i}]`;
    vParts.push(`${vPrev}[${i}:v]xfade=transition=${transition}:duration=${fade.toFixed(3)}:offset=${Math.max(0, offset).toFixed(3)}${vOut}`);
    aParts.push(`${aPrev}[${i}:a]acrossfade=d=${fade.toFixed(3)}${aOut}`);
    vPrev = vOut;
    aPrev = aOut;
    if (i < n - 1) {
      offset += durations[i] - fade;
    }
  }

  const fc = `${vParts.join(';')};${aParts.join(';')}`;
  await execFileAsync(FFMPEG, [
    '-y', ...inputs,
    '-filter_complex', fc,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', outputPath,
  ], 900000);
}

const LOUDNESS_PRESETS = {
  quiet: { i: -20, lra: 11, tp: -2 },
  normal: { i: -16, lra: 11, tp: -1.5 },
  loud: { i: -13, lra: 9, tp: -1 },
};

/**
 * One-pass loudnorm — good enough for an occasional-user "fix my volume"
 * tool. True two-pass (measure then apply exact I/LRA/TP) is more accurate
 * but doubles encode time and requires parsing loudnorm's stderr JSON; for
 * a single click on short clips one-pass is the right tradeoff here.
 * @param {{ preset?: 'quiet'|'normal'|'loud', crf?: number }} [opts]
 */
async function normalizeAudioLoudness(inputPath, outputPath, opts = {}) {
  const preset = LOUDNESS_PRESETS[opts.preset] || LOUDNESS_PRESETS.normal;
  const probe = await probeVideo(inputPath);
  if (!probe.hasAudio) throw new Error('Video has no audio track to normalize');
  const crf = Math.min(35, Math.max(18, Number(opts.crf) || 23));
  const af = `loudnorm=I=${preset.i}:LRA=${preset.lra}:TP=${preset.tp}`;
  try {
    await execFileAsync(FFMPEG, [
      '-y', '-i', inputPath,
      '-c:v', 'copy',
      '-af', af,
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath,
    ], 600000);
  } catch {
    await execFileAsync(FFMPEG, [
      '-y', '-i', inputPath,
      '-af', af,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath,
    ], 600000);
  }
}

/**
 * Two-pass palette GIF export (ffmpeg's standard high-quality GIF technique):
 * pass 1 builds an optimized colour palette from the (trimmed, scaled) video,
 * pass 2 applies it with dithering.
 * @param {{ fps?: number, width?: number, startSec?: number, endSec?: number }} [opts]
 */
async function videoToGif(inputPath, outputPath, opts = {}) {
  const fps = Math.min(30, Math.max(1, Math.round(Number(opts.fps) || 12)));
  const width = opts.width ? Math.max(80, Math.min(1280, Math.round(Number(opts.width)))) : 480;
  const startSec = Math.max(0, Number(opts.startSec) || 0);
  const endSec = opts.endSec != null && opts.endSec !== '' ? Number(opts.endSec) : null;
  const dir = path.dirname(outputPath);
  const palettePath = path.join(dir, `gif_palette_${Date.now()}.png`);

  const trimArgs = [];
  if (startSec) trimArgs.push('-ss', String(startSec));
  trimArgs.push('-i', inputPath);
  if (endSec != null && Number.isFinite(endSec)) trimArgs.push('-to', String(endSec));

  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos`;

  await execFileAsync(FFMPEG, ['-y', ...trimArgs, '-vf', `${vf},palettegen=stats_mode=diff`, palettePath], 300000);
  await execFileAsync(FFMPEG, [
    '-y', ...trimArgs, '-i', palettePath,
    '-filter_complex', `${vf}[x];[x][1:v]paletteuse=dither=sierra2_4a`,
    outputPath,
  ], 300000);
}

const SLIDESHOW_DIMS = {
  '9:16': [720, 1280],
  '16:9': [1280, 720],
  '1:1': [1080, 1080],
  '4:5': [864, 1080],
};

const SLIDE_FPS = 30;
const SLIDE_ZOOM = 0.15; // total zoom travel over one slide for Ken Burns moves

// Colour grades, applied after any camera move. Plain ffmpeg filters — no LUT files needed.
const MOOD_FILTERS = {
  warm: 'colorbalance=rs=.08:gs=.02:bs=-.08:rm=.06:bm=-.05,eq=saturation=1.08',
  cool: 'colorbalance=rs=-.06:bs=.08:rm=-.04:bm=.06',
  vivid: 'eq=saturation=1.35:contrast=1.08',
  mono: 'hue=s=0,eq=contrast=1.1',
  vintage: 'curves=preset=vintage',
  cinematic: 'eq=contrast=1.12:saturation=0.92,colorbalance=rs=-.04:bs=.05:rh=.05:bh=-.03,vignette=PI/5',
};

const MIXED_MOTION_CYCLE = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'];

function slideBaseVf(w, h, mode) {
  if (mode === 'crop') {
    return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
}

/** Ken Burns zoompan expression for one slide, or null for a static slide. Output frame is `on`. */
function zoompanFor(motion, frames, tw, th) {
  const t = `(on/${Math.max(1, frames - 1)})`;
  const centre = { x: "'iw/2-(iw/zoom/2)'", y: "'ih/2-(ih/zoom/2)'" };
  const zoom = 1 + SLIDE_ZOOM;
  let z;
  let x = centre.x;
  let y = centre.y;
  if (motion === 'zoom-in') z = `'1+${SLIDE_ZOOM}*${t}'`;
  else if (motion === 'zoom-out') z = `'${zoom}-${SLIDE_ZOOM}*${t}'`;
  else if (motion === 'pan-left') { z = `'${zoom}'`; x = `'(iw-iw/zoom)*(1-${t})'`; y = "'(ih-ih/zoom)/2'"; }
  else if (motion === 'pan-right') { z = `'${zoom}'`; x = `'(iw-iw/zoom)*${t}'`; y = "'(ih-ih/zoom)/2'"; }
  else return null;
  return `zoompan=z=${z}:x=${x}:y=${y}:d=${frames}:s=${tw}x${th}:fps=${SLIDE_FPS}`;
}

/** Greedy word wrap — drawtext does not wrap, so long captions would run off the frame. */
function wrapCaption(text, maxChars) {
  const words = String(text || '').split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * Build a slideshow video from 2-20 still images with optional crossfade/transition, camera
 * motion (Ken Burns), colour mood, per-slide captions and a background audio track.
 *
 * Two ways to drive it:
 *  - legacy: `secondsPerSlide` + `crossfadeSec` (all slides in upload order, same duration);
 *  - plan:   `slides` = [{ index, durationSec, caption }] in PLAY order (index = position in
 *            `imagePaths`), plus `transition`, `transitionSec`, `motion`, `mood`, `captionPosition`.
 *
 * Audio behaviour: the track is always played with `-stream_loop -1` (loop forever) then the
 * whole output is cut to the slideshow's total duration with `-t` — loops short audio and trims
 * long audio in a single pass.
 *
 * @param {string[]} imagePaths
 * @param {object} [opts]
 */
async function buildSlideshow(imagePaths, outputPath, opts = {}) {
  if (!Array.isArray(imagePaths) || imagePaths.length < 2) {
    throw new Error('At least two images are required for a slideshow');
  }
  if (imagePaths.length > 20) {
    throw new Error('Maximum 20 images per slideshow');
  }
  const aspect = opts.aspect || '9:16';
  const dims = SLIDESHOW_DIMS[aspect];
  if (!dims) throw new Error(`Unsupported aspect "${aspect}" — use 9:16, 16:9, 1:1, or 4:5`);
  const [tw, th] = dims;
  const mode = opts.mode === 'crop' ? 'crop' : 'pad';
  const perSlide = Math.max(1, Math.min(30, Number(opts.secondsPerSlide) || 3));
  const crf = Math.min(35, Math.max(18, Number(opts.crf) || 23));
  const dir = path.dirname(outputPath);

  const slides = Array.isArray(opts.slides) && opts.slides.length
    ? opts.slides.filter((sl) => Number.isInteger(sl.index) && imagePaths[sl.index])
    : imagePaths.map((_, index) => ({ index, durationSec: perSlide, caption: '' }));
  if (slides.length < 2) throw new Error('At least two slides are required');

  const transition = opts.transition && opts.transition !== 'cut' ? opts.transition : 'fade';
  const crossfadeSec = opts.transition === 'cut'
    ? 0
    : Math.max(0, Number(opts.transitionSec ?? opts.crossfadeSec) || 0);
  const moodVf = MOOD_FILTERS[opts.mood] || null;
  const needsCaptions = slides.some((sl) => sl.caption);
  const fontSize = Math.max(24, Math.round(th / 24));
  const captionPos = resolveDrawtextPosition(opts.captionPosition || 'bottom-center');
  const fontfile = needsCaptions
    ? escapeFilterPath(await resolveFontFilePath('Roboto', 'bold', dir))
    : null;
  const wrapAt = Math.max(12, Math.floor((tw * 0.84) / (fontSize * 0.55)));

  const slidePaths = [];
  for (let i = 0; i < slides.length; i += 1) {
    const sl = slides[i];
    const dur = Math.max(1, Math.min(30, Number(sl.durationSec) || perSlide));
    const frames = Math.round(dur * SLIDE_FPS);
    const motion = opts.motion === 'mixed' ? MIXED_MOTION_CYCLE[i % MIXED_MOTION_CYCLE.length] : opts.motion;
    const pan = zoompanFor(motion, frames, tw, th);

    // Camera moves work on a 2x frame so the sub-pixel crop steps stay smooth.
    const chain = pan
      ? [slideBaseVf(tw * 2, th * 2, mode), pan]
      : [slideBaseVf(tw, th, mode), `fps=${SLIDE_FPS}`];
    chain.push('setsar=1');
    if (moodVf) chain.push(moodVf);
    if (sl.caption) {
      // textfile (not text=) sidesteps every drawtext escaping rule for user/model-supplied words.
      const captionPath = path.join(dir, `caption_${i}.txt`);
      await fs.writeFile(captionPath, wrapCaption(sl.caption, wrapAt), 'utf8');
      chain.push(
        `drawtext=fontfile='${fontfile}':textfile='${escapeFilterPath(captionPath)}':fontsize=${fontSize}`
        + `:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14:line_spacing=6:x=${captionPos.x}:y=${captionPos.y}`
      );
    }
    chain.push('format=yuv420p');

    const slidePath = path.join(dir, `slide_${i}.mp4`);
    const input = pan
      ? ['-i', imagePaths[sl.index]]
      : ['-loop', '1', '-t', String(dur), '-i', imagePaths[sl.index]];
    await execFileAsync(FFMPEG, [
      '-y', ...input,
      '-vf', chain.join(','),
      '-frames:v', String(frames),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
      slidePath,
    ], 300000);
    slidePaths.push(slidePath);
  }

  const joinedPath = path.join(dir, 'slideshow_joined.mp4');
  await joinVideosWithOptionalCrossfade(slidePaths, joinedPath, { maxWidth: tw, crf, crossfadeSec, transition });

  if (opts.audioPath) {
    const joinedProbe = await probeVideo(joinedPath);
    const totalDur = joinedProbe.duration || slides.reduce((sum, sl) => sum + (Number(sl.durationSec) || perSlide), 0);
    await execFileAsync(FFMPEG, [
      '-y', '-i', joinedPath,
      '-stream_loop', '-1', '-i', opts.audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-t', String(totalDur),
      '-movflags', '+faststart',
      outputPath,
    ], 600000);
  } else {
    await fs.copyFile(joinedPath, outputPath);
  }
}

async function extractAudio(inputPath, outputPath, format = 'mp3') {
  const codec = format === 'wav'
    ? ['-c:a', 'pcm_s16le']
    : ['-c:a', 'libmp3lame', '-b:a', '192k'];
  await execFileAsync(FFMPEG, ['-y', '-i', inputPath, ...codec, outputPath]);
}

async function captureThumbnail(inputPath, outputPath, timeSec = 1) {
  await execFileAsync(FFMPEG, [
    '-y',
    '-ss', String(Math.max(0, Number(timeSec) || 0)),
    '-i', inputPath,
    '-frames:v', '1',
    '-q:v', '2',
    outputPath,
  ]);
}

// Evenly spaced downscaled JPEG frames (centre of each slice, so never a black first/last frame).
async function extractFrames(inputPath, outDir, { count = 4, duration = null, maxWidth = 768 } = {}) {
  const n = Math.max(1, Math.min(8, Math.floor(count) || 1));
  const paths = [];
  for (let i = 0; i < n; i += 1) {
    const t = duration ? (duration * (i + 0.5)) / n : i;
    const outPath = path.join(outDir, `frame-${i}.jpg`);
    await execFileAsync(FFMPEG, [
      '-y',
      '-ss', String(Math.max(0, t).toFixed(2)),
      '-i', inputPath,
      '-frames:v', '1',
      '-vf', `scale='min(${maxWidth},iw)':-2`,
      '-q:v', '4',
      outPath,
    ]);
    paths.push(outPath);
  }
  return paths;
}

const SYSTEM_FONT_FILES = {
  'dejavu-sans': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'dejavu-sans-bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'liberation-sans': '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  'liberation-sans-bold': '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
};

async function resolveFontFilePath(fontFamily = 'Roboto', fontWeight = 'normal', workDir) {
  const bold = fontWeight === 'bold' || fontWeight === '700' || Number(fontWeight) >= 600;
  const base = String(fontFamily || 'Roboto').toLowerCase().replace(/\s+/g, '-');
  const key = bold ? `${base}-bold` : base;
  if (SYSTEM_FONT_FILES[key]) return SYSTEM_FONT_FILES[key];
  if (SYSTEM_FONT_FILES[base]) return SYSTEM_FONT_FILES[base];
  return writeFontToDir(fontFamily, fontWeight, workDir);
}

function normalizeDrawtextColor(color = 'white') {
  const raw = String(color || 'white').trim();
  if (raw.startsWith('0x')) return raw;
  if (raw.startsWith('#') && raw.length === 7) return `0x${raw.slice(1)}`;
  return raw;
}

function hexToAssColor(hex, alphaByte = '00') {
  const h = String(hex || '#FFFFFF').replace('#', '').trim();
  if (h.length !== 6) return `&H${alphaByte}FFFFFF`;
  return `&H${alphaByte}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function parseFps(fpsStr) {
  if (!fpsStr || fpsStr === '0/0') return null;
  const parts = String(fpsStr).split('/');
  if (parts.length === 2) {
    const n = Number(parts[0]);
    const d = Number(parts[1]);
    if (n > 0 && d > 0) return n / d;
  }
  const n = Number(fpsStr);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function encodeWithVideoFilter(inputPath, outputPath, vfFilter) {
  const probe = await probeVideo(inputPath);
  const fps = parseFps(probe.fps);
  const args = [
    '-y', '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-vf', vfFilter,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
  ];
  if (fps) args.push('-r', String(fps));
  args.push('-c:a', 'copy', '-movflags', '+faststart', outputPath);
  await execFileAsync(FFMPEG, args);
}

function hexToDrawtextBoxColor(hex, alpha = 0.75) {
  const h = String(hex || '#000000').replace('#', '').trim();
  if (h.length === 6) return `0x${h}@${alpha}`;
  return `black@${alpha}`;
}

const DRAWTEXT_POSITIONS = {
  'top-left': { x: '40', y: '40' },
  'top-center': { x: '(w-text_w)/2', y: '40' },
  'top-right': { x: 'w-text_w-40', y: '40' },
  'center-left': { x: '40', y: '(h-text_h)/2' },
  center: { x: '(w-text_w)/2', y: '(h-text_h)/2' },
  'center-right': { x: 'w-text_w-40', y: '(h-text_h)/2' },
  'bottom-left': { x: '40', y: 'h-th-48' },
  'bottom-center': { x: '(w-text_w)/2', y: 'h-th-48' },
  'bottom-right': { x: 'w-text_w-40', y: 'h-th-48' },
  top: { x: '(w-text_w)/2', y: '40' },
  bottom: { x: '(w-text_w)/2', y: 'h-th-48' },
};

const ASS_ALIGNMENT = {
  'bottom-left': 1,
  'bottom-center': 2,
  bottom: 2,
  'bottom-right': 3,
  'center-left': 4,
  center: 5,
  'center-right': 6,
  'top-left': 7,
  'top-center': 8,
  top: 8,
  'top-right': 9,
};

function resolveDrawtextPosition(position = 'bottom-center') {
  return DRAWTEXT_POSITIONS[position] || DRAWTEXT_POSITIONS['bottom-center'];
}

function resolveAssAlignment(position = 'bottom-center') {
  return ASS_ALIGNMENT[position] || 2;
}

function buildSubtitleForceStyle({
  fontFamily = 'Roboto',
  fontSize = 24,
  fontColor = '#FFFFFF',
  fontWeight = 'normal',
  backgroundColor = '#000000',
  backgroundTransparent = false,
  position = 'bottom-center',
  outlineColor = '#000000',
  outline = 1,
} = {}) {
  const bold = fontWeight === 'bold' || fontWeight === '700' || Number(fontWeight) >= 600 ? 1 : 0;
  const name = String(fontFamily || 'Roboto').replace(/,/g, '');
  const primary = hexToAssColor(fontColor);
  const outlineAss = hexToAssColor(outlineColor);
  const outlinePx = Math.min(6, Math.max(0, Number(outline) || 1));
  const alignment = resolveAssAlignment(position);
  // Outline is set once here; the transparent branch below needs a slightly
  // larger minimum (for legibility with no background box) but must NOT
  // append a second `Outline=` — a duplicate key in the force_style string
  // is harmless to libass (last wins) but is dead confusion, not intent.
  const base = [
    `FontName=${name}`,
    `FontSize=${Math.min(96, Math.max(10, Number(fontSize) || 24))}`,
    `PrimaryColour=${primary}`,
    `Alignment=${alignment}`,
    `OutlineColour=${outlineAss}`,
    `Bold=${bold}`,
  ];
  if (backgroundTransparent) {
    return [
      ...base,
      `Outline=${Math.max(2, outlinePx)}`,
      `BackColour=&HFF000000`,
      `BorderStyle=1`,
    ].join(',');
  }
  const back = hexToAssColor(backgroundColor);
  return [
    ...base,
    `Outline=${outlinePx}`,
    `BackColour=${back}`,
    `BorderStyle=3`,
  ].join(',');
}

function escapeDrawtext(text) {
  // Truncate BEFORE escaping — slicing escaped output can cut an escape sequence in half
  // and leave a dangling backslash that breaks the whole filter string.
  return String(text || '')
    .slice(0, 120)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:');
}

function escapeFilterPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * Build a drawtext `alpha` expression that fades the label in and/or out.
 * Uses `min(1, t/fadeIn)` (ramps 0→1 over the fade-in window) and
 * `min(1, (duration-t)/fadeOut)` (ramps 1→0 over the fade-out window),
 * multiplied together when both are set — no nested if() needed, and only
 * a bare comma-escape (drawtext options are comma-separated) is required.
 * Returns null when neither fade is requested (default, additive-only).
 */
function buildFadeAlphaExpr(fadeInSec, fadeOutSec, duration) {
  const fi = Math.max(0, Number(fadeInSec) || 0);
  const fo = Math.max(0, Number(fadeOutSec) || 0);
  if (!fi && !fo) return null;
  const dur = Math.max(0, Number(duration) || 0);
  const parts = [];
  if (fi > 0) parts.push(`min(1\\,t/${fi})`);
  if (fo > 0 && dur > 0) parts.push(`min(1\\,(${dur.toFixed(3)}-t)/${fo})`);
  return parts.length ? parts.join('*') : null;
}

async function annotateVideo(inputPath, outputPath, {
  text,
  position = 'bottom-center',
  fontSize = 28,
  fontColor = 'white',
  fontFamily = 'Roboto',
  fontWeight = 'normal',
  backgroundColor = '#000000',
  backgroundTransparent = false,
  backgroundAlpha = 0.75,
  fadeInSec = 0,
  fadeOutSec = 0,
}, workDir) {
  const escaped = escapeDrawtext(text);
  const fontfile = escapeFilterPath(await resolveFontFilePath(fontFamily, fontWeight, workDir));
  const color = normalizeDrawtextColor(fontColor);
  const { x, y } = resolveDrawtextPosition(position);
  const boxPart = backgroundTransparent
    ? 'box=0:borderw=2:bordercolor=black@0.75'
    : `box=1:boxcolor=${hexToDrawtextBoxColor(backgroundColor, backgroundAlpha)}:boxborderw=10`;
  let vf = `drawtext=fontfile=${fontfile}:text='${escaped}':fontsize=${Math.min(96, Math.max(10, Number(fontSize) || 28))}:fontcolor=${color}:${boxPart}:x=${x}:y=${y}`;
  if (Number(fadeInSec) > 0 || Number(fadeOutSec) > 0) {
    const probe = await probeVideo(inputPath);
    const alphaExpr = buildFadeAlphaExpr(fadeInSec, fadeOutSec, probe.duration);
    if (alphaExpr) vf += `:alpha=${alphaExpr}`;
  }
  await encodeWithVideoFilter(inputPath, outputPath, vf);
}

async function burnSubtitles(inputPath, srtPath, outputPath, style = {}, workDir) {
  await writeFontToDir(style.fontFamily || 'Roboto', style.fontWeight, workDir);
  // The `subtitles` ffmpeg filter has been observed failing with "Unable to
  // open <path>" in production against a file this same process just wrote
  // and awaited — with no reproducible cause found in the escaping/ordering
  // logic. Stat it right before handing the path to ffmpeg so a real
  // missing/empty/permission problem surfaces as a clear error here instead
  // of ffmpeg's opaque filter-init message.
  let srtStat;
  try {
    srtStat = await fs.stat(srtPath);
  } catch (err) {
    throw new Error(`Caption file not found at ${srtPath} right before ffmpeg ran (${err.code || err.message})`);
  }
  if (!srtStat.size) {
    throw new Error(`Caption file at ${srtPath} is empty`);
  }
  const fontsDir = escapeFilterPath(workDir);
  const sub = escapeFilterPath(srtPath);
  const forceStyle = buildSubtitleForceStyle(style).replace(/'/g, "'\\''");
  const vf = `subtitles='${sub}':fontsdir='${fontsDir}':force_style='${forceStyle}'`;
  await encodeWithVideoFilter(inputPath, outputPath, vf);
}

async function extractWav16k(inputPath, wavPath) {
  await execFileAsync(FFMPEG, [
    '-y', '-i', inputPath,
    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
    wavPath,
  ]);
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-video-'));
  try {
    return await fn(dir);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readOutputFile(outputPath) {
  const buf = await fs.readFile(outputPath);
  return buf;
}

module.exports = {
  FFMPEG,
  MAX_VIDEO_BYTES,
  checkFfmpeg,
  extensionForMime,
  probeVideo,
  clipVideo,
  convertVideo,
  joinVideos,
  joinVideosWithOptionalCrossfade,
  reframeVideo,
  muteOrReplaceAudio,
  changeVideoSpeed,
  overlayImage,
  ASPECT_RATIOS,
  extractAudio,
  captureThumbnail,
  extractFrames,
  annotateVideo,
  burnSubtitles,
  extractWav16k,
  withTempDir,
  readOutputFile,
  execFileAsync,
  LOUDNESS_PRESETS,
  normalizeAudioLoudness,
  videoToGif,
  SLIDESHOW_DIMS,
  buildSlideshow,
  escapeDrawtext,
  escapeFilterPath,
  zoompanFor,
  wrapCaption,
  MOOD_FILTERS,
  XFADE_TRANSITIONS,
};
