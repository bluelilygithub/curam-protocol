'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

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

function escapeDrawtext(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .slice(0, 120);
}

async function annotateVideo(inputPath, outputPath, {
  text,
  position = 'bottom',
  fontSize = 28,
  fontColor = 'white',
}) {
  const escaped = escapeDrawtext(text);
  const y = position === 'top'
    ? '40'
    : position === 'center'
      ? '(h-text_h)/2'
      : 'h-th-48';
  await execFileAsync(FFMPEG, [
    '-y', '-i', inputPath,
    '-vf', `drawtext=text='${escaped}':fontsize=${fontSize}:fontcolor=${fontColor}:box=1:boxcolor=black@0.55:boxborderw=10:x=(w-text_w)/2:y=${y}`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'copy', '-movflags', '+faststart',
    outputPath,
  ]);
}

async function burnSubtitles(inputPath, srtPath, outputPath) {
  const sub = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  await execFileAsync(FFMPEG, [
    '-y', '-i', inputPath,
    '-vf', `subtitles='${sub}'`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'copy', '-movflags', '+faststart',
    outputPath,
  ]);
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
