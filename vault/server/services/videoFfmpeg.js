'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { writeFontToDir } = require('./googleFonts');

const FFMPEG = process.env.LOCAL_FFMPEG_COMMAND || 'ffmpeg';
const FFPROBE = process.env.LOCAL_FFPROBE_COMMAND || 'ffprobe';
const MAX_VIDEO_BYTES = Number(process.env.VIDEO_MAX_UPLOAD_MB || 80) * 1024 * 1024;

function execFileAsync(cmd, args, timeout = 180000) {
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

function buildSubtitleForceStyle({
  fontFamily = 'Roboto',
  fontSize = 24,
  fontColor = '#FFFFFF',
  fontWeight = 'normal',
  backgroundColor = '#000000',
  backgroundTransparent = false,
  outlineColor = '#000000',
  outline = 1,
} = {}) {
  const bold = fontWeight === 'bold' || fontWeight === '700' || Number(fontWeight) >= 600 ? 1 : 0;
  const name = String(fontFamily || 'Roboto').replace(/,/g, '');
  const primary = hexToAssColor(fontColor);
  const outlineAss = hexToAssColor(outlineColor);
  const outlinePx = Math.min(6, Math.max(0, Number(outline) || 1));
  if (backgroundTransparent) {
    return [
      `FontName=${name}`,
      `FontSize=${Math.min(96, Math.max(10, Number(fontSize) || 24))}`,
      `PrimaryColour=${primary}`,
      `BackColour=&HFF000000`,
      `BorderStyle=1`,
      `OutlineColour=${outlineAss}`,
      `Outline=${Math.max(2, outlinePx)}`,
      `Bold=${bold}`,
    ].join(',');
  }
  const back = hexToAssColor(backgroundColor);
  return [
    `FontName=${name}`,
    `FontSize=${Math.min(96, Math.max(10, Number(fontSize) || 24))}`,
    `PrimaryColour=${primary}`,
    `BackColour=${back}`,
    `BorderStyle=3`,
    `OutlineColour=${outlineAss}`,
    `Outline=${outlinePx}`,
    `Bold=${bold}`,
  ].join(',');
}

function escapeDrawtext(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .slice(0, 120);
}

function escapeFilterPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function annotateVideo(inputPath, outputPath, {
  text,
  position = 'bottom',
  fontSize = 28,
  fontColor = 'white',
  fontFamily = 'Roboto',
  fontWeight = 'normal',
  backgroundColor = '#000000',
  backgroundTransparent = false,
  backgroundAlpha = 0.75,
}, workDir) {
  const escaped = escapeDrawtext(text);
  const fontfile = escapeFilterPath(await resolveFontFilePath(fontFamily, fontWeight, workDir));
  const color = normalizeDrawtextColor(fontColor);
  const y = position === 'top'
    ? '40'
    : position === 'center'
      ? '(h-text_h)/2'
      : 'h-th-48';
  const boxPart = backgroundTransparent
    ? 'box=0:borderw=2:bordercolor=black@0.75'
    : `box=1:boxcolor=${hexToDrawtextBoxColor(backgroundColor, backgroundAlpha)}:boxborderw=10`;
  const vf = `drawtext=fontfile=${fontfile}:text='${escaped}':fontsize=${Math.min(96, Math.max(10, Number(fontSize) || 28))}:fontcolor=${color}:${boxPart}:x=(w-text_w)/2:y=${y}`;
  await encodeWithVideoFilter(inputPath, outputPath, vf);
}

async function burnSubtitles(inputPath, srtPath, outputPath, style = {}, workDir) {
  await writeFontToDir(style.fontFamily || 'Roboto', style.fontWeight, workDir);
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
  extractAudio,
  captureThumbnail,
  annotateVideo,
  burnSubtitles,
  extractWav16k,
  withTempDir,
  readOutputFile,
  execFileAsync,
};
