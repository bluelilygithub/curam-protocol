'use strict';

// One HTML renderer for the live preview and the PDF/PNG exporter, so what a person sees is what they download.
// The output is static (no scripts) and every value from a deck is escaped before it reaches the page.
// Where things go comes from layouts.js plan(), the same geometry the PPTX exporter uses.

const { normalizeDeck, resolveTheme } = require('./schema');
const { plan } = require('./layouts');

const SIZES = {
  '16:9': { w: 1280, h: 720 },
  '4:3': { w: 960, h: 720 },
  '1:1': { w: 900, h: 900 },
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeFont = (s) => String(s || 'Arial, sans-serif').replace(/[<>;{}]/g, '').slice(0, 160);
const safeColor = (s, fallback) => /^#[0-9a-fA-F]{3,8}$/.test(String(s || '')) ? s : fallback;

/** Only allow image references we can justify: a data URL for a picture, a public web URL, or our own owned asset path. */
function safeImage(ref) {
  const value = String(ref || '').trim();
  if (!value) return '';
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(value)) return value;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(value)) return value;
  if (/^\/api\/presentations\/assets\/\d+\/[A-Za-z0-9._-]+$/.test(value)) return value;
  return '';
}

/** "#rrggbb" at an opacity, as rgba(); other forms are returned unchanged. */
function withAlpha(hex, alpha) {
  if (alpha == null || alpha >= 1) return hex;
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length < 6) return hex;
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const pos = (b) => `left:${b.x.toFixed(2)}%;top:${b.y.toFixed(2)}%;width:${b.w.toFixed(2)}%;height:${b.h.toFixed(2)}%`;
const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

function renderSlide(slide, index, colours, opts) {
  const p = plan(slide, opts);
  const scale = opts.scale;
  const shapes = p.shapes.map((s) => {
    const style = [pos(s)];
    if (s.fill) style.push(`background:${withAlpha(colours[s.fill], s.alpha)}`);
    if (s.stroke) style.push(`border:${Math.max(1, Math.round((s.strokeWidth || 1) * scale))}px solid ${colours[s.stroke]}`);
    if (s.kind === 'ellipse') style.push('border-radius:50%');
    if (s.kind === 'tri') style.push('clip-path:polygon(100% 0,100% 100%,0 100%)');
    const label = s.label ? `<span style="color:${colours[s.labelColor || 'bg']};font-size:${Math.round((s.labelSize || 16) * scale)}px">${escapeHtml(s.label)}</span>` : '';
    return `<div class="shape" style="${style.join(';')}">${label}</div>`;
  }).join('');
  const images = p.images.map((im) => {
    const src = safeImage(im.ref);
    return src ? `<img class="pic" style="${pos(im)};object-fit:${im.fit === 'cover' ? 'cover' : 'contain'}" src="${escapeHtml(src)}" alt="">` : '';
  }).join('');
  const boxes = p.boxes.map((b) => {
    const style = [pos(b), `font-size:${Math.round(b.size * scale)}px`, `color:${colours[b.color] || colours.text}`,
      `text-align:${b.align || 'left'}`, `justify-content:${JUSTIFY[b.valign] || 'flex-start'}`];
    if (b.bold) style.push('font-weight:700');
    if (b.italic) style.push('font-style:italic');
    const inner = b.bullets
      ? `<ul>${b.bullets.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : `<div class="txt">${escapeHtml(b.text)}</div>`;
    return `<div class="box" style="${style.join(';')}">${inner}</div>`;
  }).join('');
  const num = p.number ? `<span class="num">${index + 1}</span>` : '';
  return `<section class="slide layout-${p.layout} design-${p.design}" data-slide="${index + 1}">${shapes}${images}${boxes}${opts.logo}${num}</section>`;
}

/** Build a complete static HTML document from a canonical deck. */
function renderDeckHtml(input, themeInput, { applyBrand = false, brand = null } = {}) {
  const deck = normalizeDeck(input);
  const base = { ...resolveTheme(themeInput || deck.themeId) };
  if (applyBrand && brand?.available) {
    for (const key of ['bg', 'text', 'primary', 'muted', 'font']) if (brand[key]) base[key] = brand[key];
    if (brand.logoDataUrl) { base.showLogo = true; base.logoDataUrl = brand.logoDataUrl; }
  }
  const size = SIZES[deck.aspect] || SIZES['16:9'];
  const scale = size.h / 720;
  const colours = {
    bg: safeColor(base.bg, '#ffffff'),
    text: safeColor(base.text, '#1f2937'),
    primary: safeColor(base.primary, '#9B5B46'),
    muted: safeColor(base.muted, '#6b7280'),
  };
  const font = safeFont(base.font);
  const logoSrc = base.showLogo && base.logoDataUrl ? safeImage(base.logoDataUrl) : '';
  const logo = logoSrc ? `<img class="logo" src="${escapeHtml(logoSrc)}" alt="">` : '';
  const opts = { designId: deck.designId, aspect: deck.aspect, titleSize: base.titleSize, scale, logo };
  const slides = deck.slides.map((s, i) => renderSlide(s, i, colours, opts)).join('\n');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(deck.title)}</title>
<style>
  @page { size: ${size.w}px ${size.h}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${colours.bg}; }
  body { color: ${colours.text}; font-family: ${font}; }
  .slide { position: relative; width: ${size.w}px; height: ${size.h}px; background: ${colours.bg};
           overflow: hidden; break-after: page; page-break-after: always; }
  .slide:last-child { break-after: auto; page-break-after: auto; }
  .shape { position: absolute; display: flex; align-items: center; justify-content: center; font-weight: 700; }
  .pic { position: absolute; }
  .box { position: absolute; display: flex; flex-direction: column; overflow: hidden; line-height: 1.25; }
  .txt { white-space: pre-wrap; }
  .box ul { margin: 0; padding-left: 1.2em; }
  .box li { line-height: 1.35; margin-bottom: 0.45em; }
  .box li::marker { color: ${colours.primary}; }
  .logo { position: absolute; top: ${Math.round(32 * scale)}px; right: ${Math.round(44 * scale)}px; max-width: ${Math.round(150 * scale)}px; max-height: ${Math.round(60 * scale)}px; object-fit: contain; }
  .num { position: absolute; bottom: ${Math.round(24 * scale)}px; right: ${Math.round(40 * scale)}px; color: ${colours.muted}; font-size: ${Math.round(16 * scale)}px; }
</style></head><body>
${slides}
</body></html>`;
}

module.exports = { renderDeckHtml, safeImage, withAlpha, SIZES };
