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
// 'after' = separate closing screen appended after the video; 'last-frame' = freeze the last frame and put
// the message over it (video gets longer); 'over-end' = message over the final seconds of the video (same length).
const PLACEMENTS = ['after', 'last-frame', 'over-end'];

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
  const placement = PLACEMENTS.includes(input.placement) ? input.placement : 'after';
  // A separate closing screen fades in over at most half its time; a message laid over the picture may take the whole time.
  const fadeSec = clamp(input.fadeSec === '' || input.fadeSec == null ? 0.5 : Number(input.fadeSec) || 0, 0, placement === 'after' ? durationSec / 2 : durationSec);
  // How much the picture is darkened (tinted with bgColor) behind a message laid over it: 0 = not at all, 100 = solid.
  const dimRaw = input.dimPct === '' || input.dimPct == null ? 60 : Number(input.dimPct);
  const dimPct = clamp(Number.isFinite(dimRaw) ? dimRaw : 60, 0, 100);
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
    placement,
    dimPct,
  };
}

/**
 * The filter graph for a message laid OVER the picture (placements 'last-frame' and 'over-end'). Pure, so it is unit tested.
 *  - dim = 0           no tint: the picture keeps all its colour.
 *  - fadeSec = 0       the tint switches on at once (drawbox).
 *  - otherwise         the tint fades in over fadeSec: a colour layer whose opacity ramps up, laid over the picture.
 * `draws` are the text drawtext filters; `enable` is the ":enable=..." clause that holds the text/tint until startAt.
 */
function overlayVideoGraph({ w, h, fps, pad = '', startAt, fadeSec, dimPct, bgColor, draws, enable = '' }) {
  const base = `[0:v]scale=${w}:${h},setsar=1,fps=${fps}${pad}`;
  const tail = `${draws.length ? `${draws.join(',')},` : ''}format=yuv420p[v]`;
  const dim = Math.max(0, Math.min(1, Number(dimPct) / 100));
  if (!(dim > 0)) return `${base},${tail}`;
  if (!(fadeSec > 0)) return `${base},drawbox=x=0:y=0:w=iw:h=ih:color=0x${bgColor}@${dim.toFixed(2)}:t=fill${enable},${tail}`;
  return `${base}[base];`
    + `color=c=0x${bgColor}:s=${w}x${h}:r=${fps},format=rgba,colorchannelmixer=aa=${dim.toFixed(2)},`
    + `fade=t=in:st=${Number(startAt).toFixed(3)}:d=${Number(fadeSec).toFixed(3)}:alpha=1[tint];`
    + `[base][tint]overlay=shortest=1,${tail}`;
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

  const overlay = spec.placement !== 'after';
  // Overlay modes: the message appears at `startAt` seconds on the (possibly frozen-extended) video.
  const srcDur = probe.duration || 0;
  const D = overlay && spec.placement === 'over-end' ? Math.min(spec.durationSec, Math.max(0.5, srcDur)) : spec.durationSec;
  const startAt = spec.placement === 'last-frame' ? srcDur : Math.max(0, srcDur - D);
  const fadeSec = Math.min(spec.fadeSec, overlay ? D : D / 2);
  const enable = overlay ? `:enable='gte(t,${startAt.toFixed(3)})'` : '';
  const alphaExpr = overlay && fadeSec > 0 ? `:alpha='min(1,max(0,(t-${startAt.toFixed(3)})/${fadeSec}))'` : '';

  const draws = [];
  const blocks = layoutEndCard(spec, w, h);
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    const textPath = path.join(workDir, `endcard-${i}.txt`);
    await fs.writeFile(textPath, b.text, 'utf8');
    const color = b.kind === 'button' ? spec.buttonTextColor : spec.textColor;
    const colorAlpha = b.kind === 'url' && !alphaExpr ? '@0.85' : '';
    let d = `drawtext=fontfile=${fontfile}:textfile=${escapeFilterPath(textPath)}:expansion=none`
      + `:fontsize=${b.size}:fontcolor=0x${color}${colorAlpha}:line_spacing=${Math.round(b.size * 0.25)}`
      + `:x=(w-text_w)/2:y=${b.y}${enable}${alphaExpr}`;
    if (b.kind === 'button') {
      d += `:box=1:boxcolor=0x${spec.buttonColor}:boxborderw=${b.pad}`;
    }
    draws.push(d);
  }

  if (overlay) {
    // Tint the picture behind the text (colour = bgColor, strength = dimPct, fading in over fadeSec) so the text stays readable.
    const pad = spec.placement === 'last-frame' ? `,tpad=stop_mode=clone:stop_duration=${D}` : '';
    const buildArgs = (fade) => {
      let filterO = overlayVideoGraph({ w, h, fps, pad, startAt, fadeSec: fade, dimPct: spec.dimPct, bgColor: spec.bgColor, draws, enable });
      if (probe.hasAudio && spec.placement === 'last-frame') {
        filterO += `;[0:a]aresample=${AUDIO_RATE},aformat=channel_layouts=stereo,apad=pad_dur=${D}[a]`;
      }
      const oargs = ['-y', '-i', inputPath, '-filter_complex', filterO, '-map', '[v]'];
      if (probe.hasAudio) {
        oargs.push('-map', spec.placement === 'last-frame' ? '[a]' : '0:a', '-c:a', 'aac', '-b:a', '160k');
      }
      if (spec.placement === 'last-frame' && srcDur) oargs.push('-t', String(srcDur + D));
      oargs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath);
      return oargs;
    };
    try {
      await execFileAsync(FFMPEG, buildArgs(fadeSec));
    } catch (err) {
      // The smooth tint fade is the only part that needs an unusual filter chain. If this machine's ffmpeg rejects it, still
      // deliver the video with the tint switching on at once rather than failing the whole job.
      if (!(fadeSec > 0 && spec.dimPct > 0)) throw err;
      await execFileAsync(FFMPEG, buildArgs(0));
    }
    return;
  }

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
  appendEndCard, normalizeEndCard, layoutEndCard, overlayVideoGraph, PLACEMENTS, MIN_DURATION_SEC, MAX_DURATION_SEC,
};
