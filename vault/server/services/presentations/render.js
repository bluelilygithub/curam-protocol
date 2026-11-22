'use strict';

// One HTML renderer for the live preview and the PDF/PNG exporter, so what a person sees is what they download.
// The output is static (no scripts) and every value from a deck is escaped before it reaches the page.

const { normalizeDeck, resolveTheme } = require('./schema');

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

function slideBody(slide, theme) {
  const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean).slice(0, 6) : [];
  const list = bullets.length ? `<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : '';
  const body = slide.body ? `<p class="body">${escapeHtml(slide.body)}</p>` : '';
  const title = `<h1>${escapeHtml(slide.title)}</h1>`;
  const image = safeImage(slide.imageRef) ? `<img src="${escapeHtml(slide.imageRef)}" alt="">` : '';
  switch (slide.layout) {
    case 'title':
      return `<div class="center">${title}${slide.body ? `<p class="subtitle">${escapeHtml(slide.body)}</p>` : ''}</div>`;
    case 'closing':
      return `<div class="center">${title}${body}</div>`;
    case 'picture':
      return `<div class="split">${image ? `<figure>${image}</figure>` : ''}<div>${title}${body}</div></div>`;
    case 'two-column':
      return `<div class="split"><div>${title}${body}</div><div>${list}</div></div>`;
    default:
      return `${title}${list}${body}`;
  }
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
  const bg = safeColor(base.bg, '#ffffff');
  const fg = safeColor(base.text, '#1f2937');
  const accent = safeColor(base.primary, '#9B5B46');
  const muted = safeColor(base.muted, '#6b7280');
  const font = safeFont(base.font);
  const logo = base.showLogo && base.logoDataUrl ? `<img class="logo" src="${escapeHtml(safeImage(base.logoDataUrl) || '')}" alt="">` : '';
  const slides = deck.slides.map((s, i) => (
    `<section class="slide" data-slide="${i + 1}">${logo}<div class="content">${slideBody(s, base)}</div><span class="num">${i + 1}</span></section>`
  )).join('\n');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(deck.title)}</title>
<style>
  @page { size: ${size.w}px ${size.h}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${bg}; }
  body { color: ${fg}; font-family: ${font}; }
  .slide { position: relative; width: ${size.w}px; height: ${size.h}px; padding: 72px 84px; background: ${bg};
           overflow: hidden; break-after: page; page-break-after: always; display: flex; align-items: center; }
  .slide:last-child { break-after: auto; page-break-after: auto; }
  .content { width: 100%; max-height: 100%; }
  h1 { font-size: ${Math.max(24, Math.min(72, Number(base.titleSize) || 44))}px; line-height: 1.1; margin: 0 0 28px; color: ${fg}; }
  ul { margin: 0; padding-left: 1.3em; }
  li { font-size: 30px; line-height: 1.45; margin-bottom: 18px; }
  .body, .subtitle { font-size: 30px; line-height: 1.45; color: ${muted}; white-space: pre-wrap; margin: 0; }
  .subtitle { font-size: 36px; }
  .center { text-align: center; }
  .center h1 { font-size: ${Math.max(32, (Math.min(72, Number(base.titleSize) || 44)) + 12)}px; margin-bottom: 36px; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
  .split figure { margin: 0; }
  .split img { width: 100%; max-height: ${size.h - 180}px; object-fit: contain; border-radius: 12px; border: 2px solid ${accent}; }
  .logo { position: absolute; top: 32px; right: 44px; max-width: 150px; max-height: 60px; object-fit: contain; }
  .num { position: absolute; bottom: 28px; right: 44px; color: ${muted}; font-size: 18px; }
</style></head><body>
${slides}
</body></html>`;
}

module.exports = { renderDeckHtml, safeImage, SIZES };
