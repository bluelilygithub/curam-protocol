'use strict';

// "Animated captions": captions that follow the speech word by word (the spoken word lights up, or the words pop in one at a time),
// laid over a video. The caption text comes from SRT cues, as in Caption studio; an SRT only times a whole cue, so each cue's time is
// shared out over its words by length (an estimate, the same one the "script timing" fallback makes).
//
// How it is drawn: a small page (the caption band: the full width of the video, a strip of its height) is drawn by headless Chromium
// once for each change (a new word), saved as a see-through PNG, and ffmpeg lays that picture sequence over the video for the right
// lengths of time. A 60 s talk is about 150 pictures, not 1800 frames. The soundtrack is copied unchanged.
// Colours and font can come from the person's Brand Kit (read on the server).

const fs = require('fs/promises');
const path = require('path');
const { parseSrtLoose } = require('./srtUtils');
const { renderStatePngs, RenderCancelled } = require('./htmlVideoRender');
const { execFileAsync, FFMPEG, probeVideo } = require('./videoFfmpeg');
const animatedTitle = require('./animatedTitle');

const HEX = /^#[0-9a-f]{6}$/i;
const STYLES = ['highlight', 'pop'];
const POSITIONS = ['bottom', 'middle', 'top'];
const SIZES = { small: 0.05, medium: 0.065, large: 0.085 }; // of the shorter side of the picture
const MAX_WORDS_PER_PAGE = 5;
const MAX_CHARS_PER_PAGE = 34;
const MAX_STATES = 1800;
const DEFAULTS = { text: '#ffffff', highlight: '#ffd400', box: '#000000' };

class AnimatedCaptionsError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function hexOr(v, fallback) {
  const s = String(v || '').trim();
  return HEX.test(s) ? s.toLowerCase() : fallback;
}

/** Checks the options the person chose. Always returns a clean object. */
function normalizeOptions(input) {
  const i = input && typeof input === 'object' ? input : {};
  return {
    style: STYLES.includes(i.style) ? i.style : 'highlight',
    position: POSITIONS.includes(i.position) ? i.position : 'bottom',
    size: SIZES[i.size] ? i.size : 'medium',
    text: hexOr(i.text, DEFAULTS.text),
    highlight: hexOr(i.highlight, DEFAULTS.highlight),
    box: i.box === true,
    boxColor: hexOr(i.boxColor, DEFAULTS.box),
    fontSource: animatedTitle.FONT_SOURCES.includes(i.fontSource) ? i.fontSource : 'standard',
    useBrandColours: i.useBrandColours === true,
  };
}

/** Each cue's words, with the cue's time shared out by word length: [{ text, startMs, endMs }] per cue. */
function wordTimings(cues) {
  return cues.map((cue) => {
    const words = String(cue.text).split(/\s+/).filter(Boolean);
    const total = words.reduce((n, w) => n + Math.max(2, w.length) + 1, 0) || 1;
    const span = Math.max(1, cue.endMs - cue.startMs);
    let at = cue.startMs;
    return words.map((text, idx) => {
      const share = ((Math.max(2, text.length) + 1) / total) * span;
      const start = Math.round(at);
      at += share;
      return { text, startMs: start, endMs: idx === words.length - 1 ? cue.endMs : Math.round(at) };
    });
  });
}

/** Splits one cue's words into short pages (at most 5 words and about 34 letters), preferring to stop after . , ! ? ; : */
function pagesOf(words) {
  const pages = [];
  let page = [];
  let chars = 0;
  const flush = () => { if (page.length) pages.push(page); page = []; chars = 0; };
  for (const w of words) {
    if (page.length && (page.length >= MAX_WORDS_PER_PAGE || chars + w.text.length + 1 > MAX_CHARS_PER_PAGE)) flush();
    page.push(w);
    chars += w.text.length + 1;
    if (page.length >= 2 && /[.,!?;:]$/.test(w.text)) flush();
  }
  flush();
  return pages;
}

/**
 * The timeline: pages of words, and a list of segments { startMs, endMs, page, active } (page -1 = nothing on screen). Each segment is one
 * picture to draw. `active` is the word that is being spoken. Segments never overlap: a page that starts before the last one ended
 * takes over at once.
 */
function buildTimeline(cues) {
  const pages = [];
  for (const words of wordTimings(cues)) for (const p of pagesOf(words)) pages.push(p);
  pages.sort((a, b) => a[0].startMs - b[0].startMs);
  const raw = [];
  pages.forEach((words, page) => {
    const takeOver = page + 1 < pages.length ? pages[page + 1][0].startMs : Infinity; // a later page starts: this one stops
    const end = Math.min(words[words.length - 1].endMs, takeOver);
    words.forEach((w, active) => {
      if (w.startMs >= end) return;
      raw.push({ startMs: w.startMs, endMs: Math.min(active === words.length - 1 ? end : words[active + 1].startMs, end), page, active });
    });
  });
  const segs = [];
  let cursor = 0;
  for (const seg of raw) {
    if (seg.endMs <= seg.startMs) continue;
    if (seg.startMs > cursor) segs.push({ startMs: cursor, endMs: seg.startMs, page: -1, active: -1 });
    segs.push(seg);
    cursor = seg.endMs;
  }
  return { pages, segments: segs };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Even numbers only (the video format needs them). */
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Size of the caption band for a picture of `width` x `height` (shown size). */
function bandSize(width, height, size) {
  const base = Math.min(width, height);
  const font = Math.round(base * SIZES[size]);
  const bandH = even(Math.min(height * 0.5, font * 1.3 * 3 + base * 0.12));
  return { width: even(width), height: bandH, font, base };
}

/**
 * The band page. `pages` is an array of arrays of words (text only). `window.show(page, active)` draws one state. Text goes in with
 * textContent, and the list of words is embedded as JSON with < escaped, so nothing a person types can become markup.
 */
function buildHtml(opts, band, colours, pages, assets = {}) {
  const family = assets.fontDataUrl ? `'${assets.fontFamily}', Arial, Helvetica, sans-serif` : 'Arial, Helvetica, sans-serif';
  const fontFace = assets.fontDataUrl
    ? `@font-face{font-family:'${assets.fontFamily}';src:url(${assets.fontDataUrl}) format('${assets.fontFormat}');font-weight:400;font-style:normal}`
    : '';
  const justify = { bottom: 'flex-end', middle: 'center', top: 'flex-start' }[opts.position];
  const margin = Math.round(band.base * 0.06);
  const stroke = Math.max(2, Math.round(band.font * 0.08));
  const boxCss = opts.box
    ? `background:${colours.box};padding:${Math.round(band.font * 0.18)}px ${Math.round(band.font * 0.4)}px;border-radius:${Math.round(band.font * 0.3)}px;`
    : '';
  const data = JSON.stringify(pages.map((p) => p.map((w) => w.text))).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFace}
html,body{margin:0;width:${band.width}px;height:${band.height}px;overflow:hidden;background:transparent}
.wrap{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;justify-content:${justify};align-items:center;padding:${margin}px 0;box-sizing:border-box}
.line{max-width:88%;text-align:center;font-family:${family};font-size:${band.font}px;line-height:1.25;font-weight:${assets.fontDataUrl ? 400 : 800};${boxCss}}
.w{display:inline-block;margin:0 .14em;color:${colours.text};${opts.box ? '' : `-webkit-text-stroke:${stroke}px rgba(0,0,0,.85);paint-order:stroke fill;text-shadow:0 2px ${Math.round(band.font * 0.12)}px rgba(0,0,0,.5);`}}
.w.on{color:${colours.highlight};transform:scale(1.12)}
.w.off{opacity:.62}
.w.hide{display:none}
</style></head><body><div class="wrap"><div class="line" id="line"></div></div><script>
(function () {
  var PAGES = ${data};
  var STYLE = ${JSON.stringify(opts.style)};
  var line = document.getElementById('line');
  window.show = function (page, active) {
    line.textContent = '';
    line.style.display = page < 0 ? 'none' : '';
    if (page < 0) return;
    PAGES[page].forEach(function (text, i) {
      var s = document.createElement('span');
      var cls = 'w';
      if (STYLE === 'highlight') cls += i === active ? ' on' : (i > active ? ' off' : '');
      else cls += i > active ? ' hide' : (i === active ? ' on' : '');
      s.className = cls;
      s.textContent = text;
      line.appendChild(s);
    });
  };
  window.show(-1, -1);
})();
</script></body></html>`;
}

/** What goes into the concat file: one picture for each segment, with how long it stays. */
function concatList(segments, names, blankName) {
  const lines = [];
  segments.forEach((seg, i) => {
    lines.push(`file '${seg.page < 0 ? blankName : names[i]}'`, `duration ${((seg.endMs - seg.startMs) / 1000).toFixed(3)}`);
  });
  const last = segments[segments.length - 1];
  lines.push(`file '${last.page < 0 ? blankName : names[segments.length - 1]}'`); // the last picture is repeated, as the format needs
  return `${lines.join('\n')}\n`;
}

/** Overlay position (ffmpeg expression) for the band. */
function overlayY(position) {
  return position === 'top' ? '0' : position === 'middle' ? '(main_h-overlay_h)/2' : 'main_h-overlay_h';
}

/**
 * Builds the captioned video. `brand` comes from animatedTitle.loadBrand (colours and font only here). Writes outPath.
 * @returns {Promise<{ pictures: number, words: number }>}
 */
async function makeAnimatedCaptions({ videoPath, srt, options, brand = {}, outPath, workDir, signal, log = () => {}, render = renderStatePngs }) {
  const cues = parseSrtLoose(srt);
  if (!cues.length) throw new AnimatedCaptionsError('The captions have no timings. Use captions in SRT format, or let the studio time your script first.');
  const { pages, segments } = buildTimeline(cues);
  if (segments.length > MAX_STATES) throw new AnimatedCaptionsError(`These captions have too many words for animated captions (${pages.reduce((n, p) => n + p.length, 0)}). Use a shorter video, or the standard look.`);
  const info = await probeVideo(videoPath);
  if (!info.width || !info.height) throw new AnimatedCaptionsError('That video could not be read.');
  const turned = info.rotation === 90 || info.rotation === 270;
  const shownW = turned ? info.height : info.width;
  const shownH = turned ? info.width : info.height;
  const band = bandSize(shownW, shownH, options.size);
  const colours = brand.colours
    ? { text: brand.colours.text, highlight: brand.colours.accent, box: brand.colours.background }
    : { text: options.text, highlight: options.highlight, box: options.boxColor };
  const html = buildHtml(options, band, colours, pages, brand.font || {});
  const states = [...segments.map((s) => [s.page, s.active]), [-1, -1]]; // the last state is the empty picture, used for the gaps
  const startedAt = Date.now();
  const names = await render({ html, width: band.width, height: band.height, states, outDir: workDir, signal });
  const blank = names[names.length - 1];
  log(`drew ${segments.length} caption pictures at ${band.width}x${band.height} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  await fs.writeFile(path.join(workDir, 'captions.txt'), concatList(segments, names, blank), 'utf8');
  if (signal?.aborted) throw new RenderCancelled();
  const filter = `[0:v][1:v]overlay=x=0:y=${overlayY(options.position)}:eof_action=pass:format=auto[v]`;
  const args = [
    '-y', '-i', videoPath, '-f', 'concat', '-safe', '0', '-i', path.join(workDir, 'captions.txt'),
    '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', '-c:a', 'copy',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '18', '-movflags', '+faststart', outPath,
  ];
  await execFileAsync(FFMPEG, args, 900000, { signal });
  return { pictures: segments.length, words: pages.reduce((n, p) => n + p.length, 0) };
}

module.exports = {
  normalizeOptions, wordTimings, pagesOf, buildTimeline, bandSize, buildHtml, concatList, overlayY, makeAnimatedCaptions,
  AnimatedCaptionsError, STYLES, POSITIONS, SIZES, DEFAULTS, MAX_STATES,
};
