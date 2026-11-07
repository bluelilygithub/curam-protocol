'use strict';

// "Animated title": an animated title screen (headline, supporting line, optional logo) made as a short video. The server builds a small
// HTML page from the person's choices (text is escaped, nothing else is accepted), and htmlVideoRender.js turns it into an MP4.
// Colours, logo and font can come from the person's Brand Kit (Graphics -> Brand Kit): the server reads them, never the browser.

const kitStore = require('./graphicsBrandKit');
const { renderHtmlToMp4 } = require('./htmlVideoRender');

const HEX = /^#[0-9a-f]{6}$/i;
const LAYOUTS = ['rise', 'centre'];
const SHAPES = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1] };
const QUALITIES = { hd: 720, full: 1080 }; // the short side of the picture
const FONT_SOURCES = ['standard', 'brand-heading', 'brand-body'];
const MIN_SEC = 2;
const MAX_SEC = 8;
const DEFAULTS = { background: '#1f2a37', text: '#ffffff', accent: '#f4c9a8' };

class AnimatedTitleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function hexOr(v, fallback) {
  const s = String(v || '').trim();
  return HEX.test(s) ? s.toLowerCase() : fallback;
}

/** Checks what the person asked for. Returns a clean spec, or { error } in plain words. */
function normalizeSpec(input) {
  const i = input && typeof input === 'object' ? input : {};
  const headline = cleanText(i.headline, 80);
  const subline = cleanText(i.subline, 120);
  if (!headline) return { error: 'Type a headline for the title.' };
  const layout = LAYOUTS.includes(i.layout) ? i.layout : 'rise';
  const shape = SHAPES[i.shape] ? i.shape : '16:9';
  const quality = QUALITIES[i.quality] ? i.quality : 'hd';
  const asked = Number(i.seconds);
  const seconds = Number.isFinite(asked) ? Math.min(MAX_SEC, Math.max(MIN_SEC, Math.round(asked * 2) / 2)) : 5;
  const fontSource = FONT_SOURCES.includes(i.fontSource) ? i.fontSource : 'standard';
  return {
    headline, subline, layout, shape, quality, seconds, fontSource,
    useBrandColours: i.useBrandColours === true,
    useLogo: i.useLogo === true,
    background: hexOr(i.background, DEFAULTS.background),
    text: hexOr(i.text, DEFAULTS.text),
    accent: hexOr(i.accent, DEFAULTS.accent),
    gradient: i.gradient !== false,
  };
}

/** Picture size in pixels (always even, as the video format needs). */
function sizeFor(shape, quality) {
  const [w, h] = SHAPES[shape] || SHAPES['16:9'];
  const short = QUALITIES[quality] || QUALITIES.hd;
  const even = (n) => Math.round(n / 2) * 2;
  return w >= h ? { width: even((short * w) / h), height: short } : { width: short, height: even((short * h) / w) };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A colour a little darker or lighter, for the gradient's far corner.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.min(255, Math.max(0, Math.round(((n >> shift) & 255) + amount * 255)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The page that is rendered. `assets` is { fontDataUrl, fontFormat, fontFamily, logoDataUrl } (any may be missing). Everything is inline:
 * no address of any kind appears in it. `colours` are the final colours { background, text, accent }.
 */
function buildHtml(spec, size, colours, assets = {}) {
  const { width, height } = size;
  const portrait = height > width;
  const base = Math.min(width, height);
  const headSize = Math.round(base * (spec.layout === 'centre' ? 0.1 : 0.105) * (portrait ? 0.95 : 1));
  const subSize = Math.round(base * 0.045);
  const family = assets.fontDataUrl ? `'${assets.fontFamily}', Arial, Helvetica, sans-serif` : 'Arial, Helvetica, sans-serif';
  const fontFace = assets.fontDataUrl
    ? `@font-face{font-family:'${assets.fontFamily}';src:url(${assets.fontDataUrl}) format('${assets.fontFormat}');font-weight:400;font-style:normal}`
    : '';
  const bg = spec.gradient ? `linear-gradient(135deg, ${colours.background}, ${shade(colours.background, 0.14)})` : colours.background;
  const centre = spec.layout === 'centre';
  const align = centre ? 'center' : 'left';
  const logoSize = Math.round(base * 0.12);
  const D = spec.seconds * 1000;
  const fadeOut = Math.min(600, D / 4);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFace}
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${colours.background}}
.stage{position:absolute;left:0;top:0;width:100%;height:100%;background:${bg}}
.block{position:absolute;left:${centre ? 0 : 8}%;width:${centre ? 100 : 84}%;top:50%;transform:translateY(-50%);text-align:${align};font-family:${family}}
.logo{display:block;height:${logoSize}px;max-width:${Math.round(width * 0.4)}px;margin:0 ${centre ? 'auto' : '0'} ${Math.round(base * 0.04)}px;object-fit:contain;opacity:0}
.head{margin:0;color:${colours.text};font-size:${headSize}px;line-height:1.15;font-weight:${assets.fontDataUrl ? 400 : 700};opacity:0;padding:0 ${centre ? '6%' : '0'}}
.rule{height:${Math.max(3, Math.round(base * 0.008))}px;width:${centre ? 18 : 40}%;margin:${Math.round(base * 0.035)}px ${centre ? 'auto' : '0'};background:${colours.accent};transform-origin:${centre ? 'center' : 'left'};transform:scaleX(0)}
.sub{margin:0;color:${colours.text};font-size:${subSize}px;line-height:1.3;opacity:0;padding:0 ${centre ? '8%' : '0'}}
</style></head><body><div class="stage"></div><div class="block">
${assets.logoDataUrl ? `<img class="logo" id="l" alt="" src="${assets.logoDataUrl}">` : ''}
<h1 class="head" id="h">${esc(spec.headline)}</h1>
${spec.subline ? '<div class="rule" id="r"></div>' : ''}
${spec.subline ? `<p class="sub" id="s">${esc(spec.subline)}</p>` : ''}
</div><script>
(function () {
  var D = ${D};
  var ease = 'cubic-bezier(.2,.8,.2,1)';
  var rise = ${centre ? "[{opacity:0,transform:'scale(.94)'},{opacity:1,transform:'none'}]" : "[{opacity:0,transform:'translateY(40px)'},{opacity:1,transform:'none'}]"};
  var list = [];
  function add(id, frames, duration, delay) {
    var el = document.getElementById(id);
    if (el) list.push(el.animate(frames, { duration: duration, delay: delay, fill: 'both', easing: ease }));
  }
  add('l', [{opacity:0},{opacity:1}], 600, 100);
  add('h', rise, 750, 250);
  add('r', [{transform:'scaleX(0)'},{transform:'scaleX(1)'}], 800, 750);
  add('s', [{opacity:0,transform:'translateY(24px)'},{opacity:1,transform:'none'}], 700, 1150);
  list.push(document.querySelector('.block').animate([{opacity:1},{opacity:0}], { duration: ${fadeOut}, delay: D - ${fadeOut}, fill: 'both' }));
  list.forEach(function (a) { a.pause(); });
  window.seek = function (ms) { list.forEach(function (a) { a.currentTime = ms; }); };
  window.seek(0);
})();
</script></body></html>`;
}

/** What the person's Brand Kit offers this tool: colours, whether there is a logo, which fonts are saved. Never the files themselves. */
async function brandOffer(db, userId) {
  const kit = await kitStore.loadKit(db, userId);
  const roles = kit.roles || {};
  const pick = (...names) => names.map((n) => roles[n]).find((c) => typeof c === 'string' && HEX.test(c)) || null;
  const background = pick('primary', 'background');
  const fonts = (await kitStore.listFonts(db, userId)).map((f) => f.role);
  return {
    hasColours: !!background,
    colours: background ? { background, text: pick('onPrimary', 'text') || '#ffffff', accent: pick('accent', 'background', 'surface') || DEFAULTS.accent } : null,
    hasLogo: /^data:image\/(png|jpeg|webp);base64,/i.test(String(kit.logoDataUrl || '')),
    fonts: { heading: fonts.includes('heading'), body: fonts.includes('body') },
  };
}

/** Reads the Brand Kit parts the spec asks for. Throws AnimatedTitleError (409, plain words) if one is not saved. */
async function loadBrand(db, userId, spec) {
  const kit = await kitStore.loadKit(db, userId);
  const roles = kit.roles || {};
  const out = { colours: null, logoDataUrl: null, font: null };
  if (spec.useBrandColours) {
    const bg = [roles.primary, roles.background].find((c) => typeof c === 'string' && HEX.test(c));
    if (!bg) throw new AnimatedTitleError('Your Brand Kit has no colours saved. Read a website in Brand Kit first, or untick "Use my Brand Kit colours".', 409);
    const text = [roles.onPrimary, roles.text].find((c) => typeof c === 'string' && HEX.test(c)) || '#ffffff';
    const accent = [roles.accent, roles.background, roles.surface].find((c) => typeof c === 'string' && HEX.test(c)) || DEFAULTS.accent;
    out.colours = { background: bg.toLowerCase(), text: text.toLowerCase(), accent: accent.toLowerCase() };
  }
  if (spec.useLogo) {
    const logo = String(kit.logoDataUrl || '');
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(logo)) throw new AnimatedTitleError('Your Brand Kit has no logo saved. Add one in Brand Kit, or untick "Add my logo".', 409);
    out.logoDataUrl = logo;
  }
  if (spec.fontSource !== 'standard') {
    const role = spec.fontSource === 'brand-heading' ? 'heading' : 'body';
    const row = await kitStore.getFontFile(db, userId, role);
    if (!row) throw new AnimatedTitleError(`No brand ${role} font is saved. Open Brand Kit, read a website and tick the ${role} font, or pick the standard font.`, 409);
    const isOtf = row.ext === 'otf';
    out.font = {
      fontFamily: `BrandTitle${String(row.sha256 || '').slice(0, 8) || 'x'}`,
      fontDataUrl: `data:${isOtf ? 'font/otf' : 'font/ttf'};base64,${Buffer.from(row.data).toString('base64')}`,
      fontFormat: isOtf ? 'opentype' : 'truetype',
    };
  }
  return out;
}

/** Builds the video. Returns { buffer? } is left to the caller: this writes outPath. */
async function makeAnimatedTitle({ spec, brand, outPath, signal, log, render = renderHtmlToMp4 }) {
  const size = sizeFor(spec.shape, spec.quality);
  const colours = brand.colours || { background: spec.background, text: spec.text, accent: spec.accent };
  const html = buildHtml(spec, size, colours, { ...(brand.font || {}), logoDataUrl: brand.logoDataUrl });
  return render({ html, width: size.width, height: size.height, seconds: spec.seconds, outPath, signal, log });
}

module.exports = {
  normalizeSpec, sizeFor, buildHtml, brandOffer, loadBrand, makeAnimatedTitle, AnimatedTitleError,
  LAYOUTS, SHAPES, QUALITIES, FONT_SOURCES, MIN_SEC, MAX_SEC, DEFAULTS,
};
