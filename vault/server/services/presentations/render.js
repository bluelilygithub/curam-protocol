'use strict';

// One HTML renderer for the live preview, presenter view and PDF/PNG exporter, so what a person sees is what they download.
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

/** Inline rich text is already sanitised by schema.js; escape everything, then reopen only the five allowed tags. */
function safeRich(html) {
  return escapeHtml(html || '')
    .replace(/&lt;\s*(\/?)\s*(strong|b|i|em|u|br)\b[\s\S]*?&gt;/gi, (_, close, tag) => `<${close}${tag.toLowerCase()}>`);
}

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

function renderShapes(shapes, colours, scale) {
  return shapes.map((s) => {
    const style = [pos(s)];
    const fill = s.fill ? withAlpha(colours[s.fill] || colours.primary, s.alpha) : 'transparent';
    if (s.fill) style.push(`background:${fill}`);
    if (s.stroke) style.push(`border:${Math.max(1, Math.round((s.strokeWidth || 1) * scale))}px solid ${colours[s.stroke] || colours.primary}`);
    if (s.kind === 'ellipse') style.push('border-radius:50%');
    if (s.kind === 'tri' || s.kind === 'triangle') style.push('clip-path:polygon(100% 0,100% 100%,0 100%)');
    if (s.rotation) style.push(`transform:rotate(${s.rotation}deg)`);
    const label = s.label ? `<span style="color:${colours[s.labelColor || 'bg']};font-size:${Math.round((s.labelSize || 16) * scale)}px">${escapeHtml(s.label)}</span>` : '';
    return `<div class="shape" style="${style.join(';')}">${label}</div>`;
  }).join('');
}

function renderChart(chart, colours) {
  if (!chart) return '';
  const head = chart.title ? `<div class="chart-title">${escapeHtml(chart.title)}</div>` : '';
  const values = chart.series.flatMap((s) => s.values);
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const palette = [colours.primary, colours.text, colours.muted, colours.bg];
  const labels = (chart.labels || []).map((l) => escapeHtml(l));
  if (chart.type === 'pie') {
    const numbers = chart.series[0]?.values || [];
    const total = Math.max(1, numbers.reduce((a, b) => a + Math.max(0, b), 0));
    let from = 0;
    const stops = numbers.map((v, i) => {
      const to = from + (Math.max(0, v) / total) * 100;
      const stop = `${palette[i % palette.length]} ${from}% ${to}%`;
      from = to;
      return stop;
    });
    return `<div class="chart">${head}<div class="chart-pie" style="background:conic-gradient(${stops.join(',')})"></div>
      <div class="chart-legend">${labels.map((l, i) => `<span>${l} · ${escapeHtml(numbers[i] ?? '')}</span>`).join('')}</div></div>`;
  }
  const n = Math.max(1, ...chart.series.map((s) => s.values.length));
  const group = 82 / n;
  const barWidth = group / (chart.series.length + 1);
  const bars = chart.series.map((s, si) => s.values.map((v, i) => {
    const height = (Math.abs(v) / max) * 68;
    const x = 8 + i * group + si * barWidth;
    return `<rect x="${x.toFixed(2)}" y="${(74 - height).toFixed(2)}" width="${(barWidth * 0.82).toFixed(2)}" height="${height.toFixed(2)}" fill="${palette[si % palette.length]}" rx="0.6" />`;
  }).join('')).join('');
  const line = chart.type === 'line' ? chart.series.map((s, si) => {
    const points = s.values.map((v, i) => `${(8 + i * group + group / 2).toFixed(2)},${(74 - (Math.abs(v) / max) * 68).toFixed(2)}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${palette[si % palette.length]}" stroke-width="1.8" />`;
  }).join('') : '';
  const legend = chart.series.map((s, i) => `<span>${escapeHtml(s.name)}</span>`).join('');
  return `<div class="chart">${head}<svg viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">
    <line x1="8" y1="74" x2="94" y2="74" stroke="${colours.muted}" stroke-width="0.4" />${bars}${line}
    ${labels.map((l, i) => `<text x="${(8 + i * group + group / 2).toFixed(2)}" y="79" text-anchor="middle" font-size="3.5" fill="${colours.text}">${l}</text>`).join('')}
  </svg><div class="chart-legend">${legend}</div></div>`;
}

function renderTable(table, colours, scale) {
  if (!table) return '';
  const rows = table.rows.map((row, ri) => `<tr>${row.map((cell) => {
    const tag = ri === 0 && table.header ? 'th' : 'td';
    return `<${tag}>${escapeHtml(cell)}</${tag}>`;
  }).join('')}</tr>`).join('');
  return `<table class="ptable" style="font-size:${Math.round(18 * scale)}px;border-color:${colours.muted}"><tbody>${rows}</tbody></table>`;
}

function renderSlide(slide, index, colours, opts) {
  const p = plan(slide, opts);
  const scale = opts.scale;
  const bg = safeColor(slide.background, colours.bg);
  const shapes = renderShapes(p.shapes, colours, scale);
  const images = p.images.map((im) => {
    const src = safeImage(im.ref);
    return src ? `<img class="pic" style="${pos(im)};object-fit:${im.fit === 'cover' ? 'cover' : 'contain'}" src="${escapeHtml(src)}" alt="">` : '';
  }).join('');
  const boxes = p.boxes.map((b) => {
    const style = [pos(b), `font-size:${Math.round(b.size * scale)}px`, `color:${colours[b.color] || colours.text}`,
      `text-align:${b.align || 'left'}`, `justify-content:${JUSTIFY[b.valign] || 'flex-start'}`];
    if (b.bold) style.push('font-weight:700');
    if (b.italic) style.push('font-style:italic');
    let inner;
    if (b.htmls) {
      inner = `<ul>${b.htmls.map((h) => `<li>${safeRich(h)}</li>`).join('')}</ul>`;
    } else if (b.bullets) {
      inner = `<ul>${b.bullets.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
    } else {
      inner = `<div class="txt">${b.html ? safeRich(b.html) : escapeHtml(b.text)}</div>`;
    }
    return `<div class="box" style="${style.join(';')}">${inner}</div>`;
  }).join('');
  const extras = (p.charts || []).map((chart) => {
    const g = chart.x == null ? '' : pos(chart);
    return `<div class="chart-wrap" style="${g}">${renderChart(chart, colours)}</div>`;
  }).join('') + (p.tables || []).map((table) => {
    const g = table.x == null ? '' : pos(table);
    return `<div class="table-wrap" style="${g}">${renderTable(table, colours, scale)}</div>`;
  }).join('');
  const num = p.number ? `<span class="num">${index + 1}</span>` : '';
  return `<section class="slide layout-${p.layout} design-${p.design}" data-slide="${index + 1}" style="background:${bg}">${shapes}${images}${boxes}${extras}${opts.logo}${num}</section>`;
}

/** Speaker-notes pages, appended to every export but never to the live preview or the slideshow. */
function renderNotesPages(deck, colours, size, scale) {
  return deck.slides.map((slide, i) => {
    const title = slide.rich?.title ? String(slide.rich.title).replace(/<[^>]*>/g, '') : slide.title;
    const note = String(slide.notes || '').trim() || 'No speaker notes for this slide.';
    return `<section class="slide notes-page" data-notes="${i + 1}" style="background:${colours.bg}">
      <div class="notes-head" style="color:${colours.primary};font-size:${Math.round(22 * scale)}px">Slide ${i + 1} · ${escapeHtml(title || 'Untitled slide')}</div>
      <div class="notes-text" style="color:${colours.text};font-size:${Math.round(26 * scale)}px">${escapeHtml(note).replace(/\n/g, '<br>')}</div>
      <div class="notes-foot" style="color:${colours.muted};font-size:${Math.round(16 * scale)}px">Speaker notes</div>
    </section>`;
  }).join('\n');
}

/** Build a complete static HTML document from a canonical deck. */
function renderDeckHtml(input, themeInput, { applyBrand = false, brand = null, includeNotes = false, font = null } = {}) {
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
  const fontFace = font?.family && font?.dataUrl
    ? `@font-face{font-family:'${safeFont(font.family).replace(/['"]/g, '')}';src:url('${String(font.dataUrl).replace(/['"<>]/g, '')}') format('${font.format === 'otf' ? 'opentype' : 'truetype'}');font-weight:400;font-style:normal}`
    : '';
  const fontFamily = font?.family && font?.dataUrl ? `'${safeFont(font.family).replace(/['"]/g, '')}', Arial, sans-serif` : safeFont(base.font);
  const logoSrc = base.showLogo && base.logoDataUrl ? safeImage(base.logoDataUrl) : '';
  const logo = logoSrc ? `<img class="logo" src="${escapeHtml(logoSrc)}" alt="">` : '';
  const opts = { designId: deck.designId, aspect: deck.aspect, titleSize: base.titleSize, scale, logo };
  const slides = deck.slides.map((s, i) => renderSlide(s, i, colours, opts)).join('\n');
  const notes = includeNotes ? renderNotesPages(deck, colours, size, scale) : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
 <title>${escapeHtml(deck.title)}</title>
 <style>
   @page { size: ${size.w}px ${size.h}px; margin: 0; }
   * { box-sizing: border-box; }
   html, body { margin: 0; padding: 0; background: ${colours.bg}; }
   body { color: ${colours.text}; font-family: ${fontFamily}; }
   ${fontFace}
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
   .chart-wrap, .table-wrap { position: absolute; }
   .chart { display: flex; flex-direction: column; width: 100%; height: 100%; }
   .chart-title { font-weight: 700; font-size: ${Math.round(18 * scale)}px; color: ${colours.primary}; }
   .chart svg { flex: 1; width: 100%; height: 100%; overflow: visible; }
   .chart-pie { flex: 1; border-radius: 50%; max-width: ${Math.round(260 * scale)}px; max-height: ${Math.round(260 * scale)}px; margin: auto; }
   .chart-legend { display: flex; flex-wrap: wrap; gap: 0.4em 1em; font-size: ${Math.round(14 * scale)}px; color: ${colours.muted}; }
   .ptable { width: 100%; height: 100%; border-collapse: collapse; background: ${colours.bg}; }
   .ptable th, .ptable td { border: 1px solid ${colours.muted}; padding: 0.35em 0.6em; text-align: left; vertical-align: top; }
   .ptable th { color: ${colours.primary}; font-weight: 700; }
   .notes-page { padding: ${Math.round(60 * scale)}px ${Math.round(70 * scale)}px; display: flex; flex-direction: column; gap: ${Math.round(24 * scale)}px; }
   .notes-head { font-weight: 700; }
   .notes-text { line-height: 1.55; white-space: pre-wrap; }
   .notes-foot { margin-top: auto; }
   .logo { position: absolute; top: ${Math.round(32 * scale)}px; right: ${Math.round(44 * scale)}px; max-width: ${Math.round(150 * scale)}px; max-height: ${Math.round(60 * scale)}px; object-fit: contain; }
   .num { position: absolute; bottom: ${Math.round(24 * scale)}px; right: ${Math.round(40 * scale)}px; color: ${colours.muted}; font-size: ${Math.round(16 * scale)}px; }
 </style></head><body>
 ${slides}
 ${notes}
 </body></html>`;
}

module.exports = { renderDeckHtml, safeImage, safeRich, withAlpha, SIZES };
