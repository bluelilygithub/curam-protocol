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
  // How long the message takes to fade OUT when it is shown between two times in the middle of a video (Title card). Defaults to the
  // fade-in length. The opening title fades out on its own schedule and the closing one stays until the end, so they ignore it.
  const fadeOutRaw = input.fadeOutSec === '' || input.fadeOutSec == null ? fadeSec : Number(input.fadeOutSec);
  const fadeOutSec = clamp(Number.isFinite(fadeOutRaw) ? fadeOutRaw : fadeSec, 0, 15);
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
    fadeOutSec,
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
 * The drawtext filters for a card's text blocks (headline, supporting line, button, web address). `enable` / `alphaExpr` are the
 * ":enable=..." and ":alpha=..." clauses that decide when the text shows and how it fades. `prefix` keeps the temporary text
 * files of two different cards (opening and closing) apart.
 */
async function cardDrawFilters({ spec, blocks, fontfile, workDir, enable = '', alphaExpr = '', prefix = 'endcard' }) {
  const draws = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    const textPath = path.join(workDir, `${prefix}-${i}.txt`);
    await fs.writeFile(textPath, b.text, 'utf8');
    const color = b.kind === 'button' ? spec.buttonTextColor : spec.textColor;
    const colorAlpha = b.kind === 'url' && !alphaExpr ? '@0.85' : '';
    // Paths are quoted: an unquoted Windows drive colon (C\:/...) is split into a stray option by ffmpeg's second parsing pass.
    let d = `drawtext=fontfile='${fontfile}':textfile='${escapeFilterPath(textPath)}':expansion=none`
      + `:fontsize=${b.size}:fontcolor=0x${color}${colorAlpha}:line_spacing=${Math.round(b.size * 0.25)}`
      + `:x=(w-text_w)/2:y=${b.y}${enable}${alphaExpr}`;
    if (b.kind === 'button') {
      d += `:box=1:boxcolor=0x${spec.buttonColor}:boxborderw=${b.pad}`;
    }
    draws.push(d);
  }
  return draws;
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

  const blocks = layoutEndCard(spec, w, h);
  const draws = await cardDrawFilters({ spec, blocks, fontfile, workDir, enable, alphaExpr });

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

/**
 * When the opening title is visible. It is fully visible for the whole `holdSec`; it then fades away over the next `fadeSec`
 * (never longer than the rest of the video), so the fade never eats into the hold. Pure, so the timing is unit tested.
 */
function introTiming({ holdSec, fadeSec, videoSec }) {
  const fade = Math.max(0, Math.min(Number(fadeSec) || 0, Math.max(0, (Number(videoSec) || 0) - holdSec)));
  const lastVisible = holdSec + fade;
  return {
    fadeSec: fade,
    lastVisible,
    enable: `:enable='lte(t,${lastVisible.toFixed(3)})'`,
    alphaExpr: fade > 0 ? `:alpha='min(1,max(0,(${lastVisible.toFixed(3)}-t)/${fade.toFixed(3)}))'` : '',
  };
}

/**
 * When the CLOSING message is visible on a video `totalSec` long: the last `durationSec` seconds, fading in over `fadeSec`
 * (never longer than that window). Pure, unit tested.
 */
function closingTiming({ totalSec, durationSec, fadeSec }) {
  const D = Math.max(0.5, Math.min(Number(durationSec) || 4, Number(totalSec) || 0));
  const startAt = Math.max(0, Number(totalSec) - D);
  const fade = Math.max(0, Math.min(Number(fadeSec) || 0, D));
  return {
    fadeSec: fade,
    startAt,
    enable: `:enable='gte(t,${startAt.toFixed(3)})'`,
    alphaExpr: fade > 0 ? `:alpha='min(1,max(0,(t-${startAt.toFixed(3)})/${fade.toFixed(3)}))'` : '',
  };
}

/**
 * One title (opening or closing) laid over a stretch of video, written as a PIECE of a larger filter graph so that it is done in
 * the SAME encoding pass as everything else (an earlier version re-encoded the whole video once per title, which was slow).
 *  - `inLabel` / `outLabel`  the stream labels this piece reads and writes, e.g. '[held]' and '[v]'.
 *  - dimPct = 0      no tint: the picture keeps all its colour.
 *  - fadeSec = 0     the tint is switched on/off at once (drawbox).
 *  - otherwise       a colour layer whose opacity ramps (fadeDir 'in' = appears, 'out' = goes away) from fadeStart over fadeSec.
 *  - `final`         this is the last piece, so it also converts to yuv420p for the encoder.
 * Pure, so the graph is unit tested without ffmpeg.
 */
function titleStage({ inLabel, outLabel, tintLabel, w, h, fps, draws, enable = '', dimPct, bgColor, fadeSec, fadeDir, fadeStart, final = false }) {
  const text = draws.join(',');
  const end = `${text}${final ? `${text ? ',' : ''}format=yuv420p` : ''}`;
  const dim = Math.max(0, Math.min(1, Number(dimPct) / 100));
  if (!(dim > 0)) return `${inLabel}${end || 'null'}${outLabel}`;
  if (!(fadeSec > 0)) return `${inLabel}drawbox=x=0:y=0:w=iw:h=ih:color=0x${bgColor}@${dim.toFixed(2)}:t=fill${enable}${end ? `,${end}` : ''}${outLabel}`;
  return `color=c=0x${bgColor}:s=${w}x${h}:r=${fps},format=rgba,colorchannelmixer=aa=${dim.toFixed(2)},`
    + `fade=t=${fadeDir}:st=${Number(fadeStart).toFixed(3)}:d=${Number(fadeSec).toFixed(3)}:alpha=1${tintLabel};`
    + `${inLabel}${tintLabel}overlay=shortest=1${end ? `,${end}` : ''}${outLabel}`;
}

/**
 * Turn the person's title settings into what titleStage needs (writes the text files and fetches the font).
 * @param {{ spec: object, kind: 'intro'|'ending', introSec: number, totalSec: number, size: { w:number, h:number, fps:number }, workDir: string }} job
 * @returns {Promise<object>} the pieces of a stage, minus its labels
 */
async function prepareTitle({ spec: rawSpec, kind, introSec = 0, totalSec, size, workDir }) {
  const spec = normalizeEndCard({ ...rawSpec, placement: 'over-end' });
  if (spec.error) throw new Error(spec.error);
  const { w, h, fps } = size;
  let timing;
  let fadeDir;
  let fadeStart;
  if (kind === 'intro') {
    const H = clamp(Number(introSec) || 3, 1, 15);
    timing = introTiming({ holdSec: H, fadeSec: spec.fadeSec, videoSec: totalSec });
    fadeDir = 'out';
    fadeStart = H;
  } else {
    timing = closingTiming({ totalSec, durationSec: spec.durationSec, fadeSec: spec.fadeSec });
    fadeDir = 'in';
    fadeStart = timing.startAt;
  }
  const fontfile = escapeFilterPath(await writeFontToDir(spec.fontFamily, spec.fontWeight, workDir));
  const blocks = layoutEndCard(spec, w, h);
  const draws = await cardDrawFilters({
    spec, blocks, fontfile, workDir, enable: timing.enable, alphaExpr: timing.alphaExpr, prefix: kind === 'intro' ? 'introcard' : 'endcard',
  });
  return {
    kind, w, h, fps, draws, enable: timing.enable, dimPct: spec.dimPct, bgColor: spec.bgColor,
    fadeSec: timing.fadeSec, fadeDir, fadeStart,
  };
}

/**
 * When a message is visible if it is shown between two times in the middle of a video: from `startSec` to `endSec`, fading in over
 * `fadeInSec` and out over `fadeOutSec` (together never more than the whole time). Pure, unit tested.
 */
function windowTiming({ startSec, endSec, fadeInSec, fadeOutSec }) {
  const S = Math.max(0, Number(startSec) || 0);
  const E = Math.max(S + 0.3, Number(endSec) || 0);
  const L = E - S;
  let fi = clamp(Number(fadeInSec) || 0, 0, L);
  let fo = clamp(Number(fadeOutSec) || 0, 0, L);
  if (fi + fo > L) {
    const k = L / (fi + fo);
    fi *= k;
    fo *= k;
  }
  const f3 = (n) => n.toFixed(3);
  const ramps = [];
  if (fi > 0) ramps.push(`(t-${f3(S)})/${f3(fi)}`);
  if (fo > 0) ramps.push(`(${f3(E)}-t)/${f3(fo)}`);
  const alphaExpr = !ramps.length ? '' : `:alpha='min(1,max(0,${ramps.length === 1 ? ramps[0] : `min(${ramps.join(',')})`}))'`;
  return { start: S, end: E, length: L, fadeIn: fi, fadeOut: fo, enable: `:enable='between(t,${f3(S)},${f3(E)})'`, alphaExpr };
}

/**
 * A title shown between two times, as a piece of a filter graph (same idea as titleStage, but the tint both fades in and out, and is
 * switched off outside the window). `timing` is from windowTiming. Pure, unit tested.
 */
function windowTitleStage({ inLabel, outLabel, tintLabel, w, h, fps, draws, dimPct, bgColor, timing, final = true }) {
  const text = draws.join(',');
  const end = `${text}${final ? `${text ? ',' : ''}format=yuv420p` : ''}`;
  const dim = Math.max(0, Math.min(1, Number(dimPct) / 100));
  if (!(dim > 0)) return `${inLabel}${end || 'null'}${outLabel}`;
  if (!(timing.fadeIn > 0 || timing.fadeOut > 0)) {
    return `${inLabel}drawbox=x=0:y=0:w=iw:h=ih:color=0x${bgColor}@${dim.toFixed(2)}:t=fill${timing.enable}${end ? `,${end}` : ''}${outLabel}`;
  }
  const f3 = (n) => n.toFixed(3);
  const fades = [];
  if (timing.fadeIn > 0) fades.push(`fade=t=in:st=${f3(timing.start)}:d=${f3(timing.fadeIn)}:alpha=1`);
  if (timing.fadeOut > 0) fades.push(`fade=t=out:st=${f3(timing.end - timing.fadeOut)}:d=${f3(timing.fadeOut)}:alpha=1`);
  return `color=c=0x${bgColor}:s=${w}x${h}:r=${fps},format=rgba,colorchannelmixer=aa=${dim.toFixed(2)},${fades.join(',')}${tintLabel};`
    + `${inLabel}${tintLabel}overlay=shortest=1:enable='between(t,${f3(timing.start)},${f3(timing.end)})'${end ? `,${end}` : ''}${outLabel}`;
}

/** Text files, font and layout for a title shown between two times. */
async function prepareWindowTitle({ spec: rawSpec, startSec, endSec, size, workDir }) {
  // The window's own length caps how slowly the message may fade in (normalizeEndCard bounds fades by durationSec).
  const spec = normalizeEndCard({ ...rawSpec, placement: 'over-end', durationSec: Math.min(15, Math.max(1, (Number(endSec) || 0) - (Number(startSec) || 0))) });
  if (spec.error) throw new Error(spec.error);
  const { w, h, fps } = size;
  const timing = windowTiming({ startSec, endSec, fadeInSec: spec.fadeSec, fadeOutSec: spec.fadeOutSec });
  const fontfile = escapeFilterPath(await writeFontToDir(spec.fontFamily, spec.fontWeight, workDir));
  const blocks = layoutEndCard(spec, w, h);
  const draws = await cardDrawFilters({ spec, blocks, fontfile, workDir, enable: timing.enable, alphaExpr: timing.alphaExpr, prefix: 'titlecard' });
  return { w, h, fps, draws, dimPct: spec.dimPct, bgColor: spec.bgColor, timing };
}

module.exports = {
  windowTiming, windowTitleStage, prepareWindowTitle,
  appendEndCard, normalizeEndCard, layoutEndCard, overlayVideoGraph, introTiming, closingTiming, titleStage, prepareTitle, cardDrawFilters, PLACEMENTS, MIN_DURATION_SEC, MAX_DURATION_SEC,
};
