'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  FFMPEG, probeVideo, execFileAsync, escapeFilterPath, wrapCaption,
} = require('./videoFfmpeg');
const { writeFontToDir } = require('./googleFonts');

const MIN_DURATION_SEC = 1;
const MAX_DURATION_SEC = 15;
const AUDIO_RATE = 48000;

function cleanHex(value, fallback) {
  const h = String(value || '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : fallback;
}

/** Black or white, whichever reads better on `hex` (used for the button label). */
function readableOn(hex) {
  const n = parseInt(hex, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '000000' : 'FFFFFF';
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Normalise user input into a safe end-card spec. Returns { error } when nothing would be drawn.
 */
function normalizeEndCard(input = {}) {
  const headline = String(input.headline || '').trim().slice(0, 120);
  const subline = String(input.subline || '').trim().slice(0, 160);
  const buttonText = String(input.buttonText || '').trim().slice(0, 40);
  const url = String(input.url || '').trim().slice(0, 100);
  if (!headline && !subline && !buttonText && !url) {
    return { error: 'Add at least a headline, button text or web address' };
  }
  const durationSec = clamp(Number(input.durationSec) || 4, MIN_DURATION_SEC, MAX_DURATION_SEC);
  const fadeSec = clamp(input.fadeSec === '' || input.fadeSec == null ? 0.5 : Number(input.fadeSec) || 0, 0, durationSec / 2);
  const bgColor = cleanHex(input.bgColor, '111111');
  const buttonColor = cleanHex(input.buttonColor, 'CC785C');
  return {
    headline,
    subline,
    buttonText,
    url,
    durationSec,
    fadeSec,
    bgColor,
    textColor: cleanHex(input.textColor, 'FFFFFF'),
    buttonColor,
    buttonTextColor: readableOn(buttonColor),
    fontFamily: String(input.fontFamily || 'Roboto'),
    fontWeight: input.fontWeight === 'normal' ? 'normal' : 'bold',
  };
}

/**
 * Lay the card's text blocks out top-to-bottom, vertically centred, in pixels.
 * Pure so it can be unit tested without ffmpeg.
 */
function layoutEndCard(spec, w, h) {
  const unit = Math.min(w, h);
  const blocks = [];
  const add = (kind, text, size, gapAfter, extra = {}) => {
    if (!text) return;
    const maxChars = Math.max(8, Math.floor((w * 0.84) / (size * 0.55)));
    const wrapped = wrapCaption(text, maxChars);
    const lines = wrapped.split('\n').length;
    blocks.push({ kind, text: wrapped, size, height: Math.round(lines * size * 1.25), gapAfter, ...extra });
  };
  add('headline', spec.headline, Math.round(unit * 0.085), Math.round(unit * 0.035));
  add('subline', spec.subline, Math.round(unit * 0.042), Math.round(unit * 0.07));
  add('button', spec.buttonText, Math.round(unit * 0.05), Math.round(unit * 0.06), { pad: Math.round(unit * 0.03) });
  add('url', spec.url, Math.round(unit * 0.04), 0);

  const total = blocks.reduce((s, b) => s + b.height + (b.kind === 'button' ? b.pad * 2 : 0) + b.gapAfter, 0)
    - (blocks.length ? blocks[blocks.length - 1].gapAfter : 0);
  let y = Math.max(0, Math.round((h - total) / 2));
  for (const b of blocks) {
    if (b.kind === 'button') y += b.pad;
    b.y = y;
    y += b.height + (b.kind === 'button' ? b.pad : 0) + b.gapAfter;
  }
  return blocks;
}

/**
 * Append an end card (call to action) to the end of a video. The card is a solid-colour
 * screen at the source's resolution and frame rate, with centred headline, subline, a
 * button-style label and a web address; it fades in, and the source audio (if any) is
 * followed by silence so the output keeps one continuous audio track.
 */
async function appendEndCard(inputPath, outputPath, rawSpec, workDir) {
  const spec = normalizeEndCard(rawSpec);
  if (spec.error) throw new Error(spec.error);

  const probe = await probeVideo(inputPath);
  if (!probe.width || !probe.height) throw new Error('Could not read the video size');
  // yuv420p needs even dimensions.
  const w = probe.width - (probe.width % 2);
  const h = probe.height - (probe.height % 2);
  const fpsParts = String(probe.fps || '30/1').split('/').map(Number);
  const fps = clamp(fpsParts[1] > 0 ? fpsParts[0] / fpsParts[1] : (fpsParts[0] || 30), 1, 60);

  const fontPath = await writeFontToDir(spec.fontFamily, spec.fontWeight, workDir);
  const fontfile = escapeFilterPath(fontPath);

  const draws = [];
  const blocks = layoutEndCard(spec, w, h);
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    const textPath = path.join(workDir, `endcard-${i}.txt`);
    await fs.writeFile(textPath, b.text, 'utf8');
    const color = b.kind === 'button' ? spec.buttonTextColor : spec.textColor;
    const alpha = b.kind === 'url' ? '@0.85' : '';
    let d = `drawtext=fontfile=${fontfile}:textfile=${escapeFilterPath(textPath)}:expansion=none`
      + `:fontsize=${b.size}:fontcolor=0x${color}${alpha}:line_spacing=${Math.round(b.size * 0.25)}`
      + `:x=(w-text_w)/2:y=${b.y}`;
    if (b.kind === 'button') {
      d += `:box=1:boxcolor=0x${spec.buttonColor}:boxborderw=${b.pad}`;
    }
    draws.push(d);
  }

  const D = spec.durationSec;
  const fadeIn = spec.fadeSec > 0 ? `,fade=t=in:st=0:d=${spec.fadeSec}` : '';
  const cardV = `color=c=0x${spec.bgColor}:s=${w}x${h}:r=${fps}:d=${D},${draws.join(',')}${fadeIn},format=yuv420p,setsar=1`;

  const args = ['-y', '-i', inputPath, '-f', 'lavfi', '-i', cardV];
  let filter = `[0:v]scale=${w}:${h},setsar=1,fps=${fps},format=yuv420p[v0];[1:v]fps=${fps}[v1];`;
  if (probe.hasAudio) {
    args.push('-f', 'lavfi', '-t', String(D), '-i', `anullsrc=r=${AUDIO_RATE}:cl=stereo`);
    filter += `[0:a]aresample=${AUDIO_RATE},aformat=channel_layouts=stereo[a0];`
      + `[2:a]aformat=channel_layouts=stereo[a1];`
      + '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]';
  } else {
    filter += '[v0][v1]concat=n=2:v=1:a=0[v]';
  }
  args.push('-filter_complex', filter, '-map', '[v]');
  if (probe.hasAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '160k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath);
  await execFileAsync(FFMPEG, args);
}

module.exports = {
  appendEndCard, normalizeEndCard, layoutEndCard, MIN_DURATION_SEC, MAX_DURATION_SEC,
};
