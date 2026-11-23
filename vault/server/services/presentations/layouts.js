'use strict';

// Slide geometry for Presentations: the design styles (decoration and margins) and the slide layouts (where each piece of text,
// picture and shape goes). Everything is in percent of the slide, with text sizes in px for a 720px-tall slide. The HTML renderer
// (preview, PDF, PNG; render.js) and the PowerPoint exporter (export.js) both draw from plan(), so they cannot drift apart.

const DESIGNS = [
  { id: 'clean', label: 'Clean', blurb: 'Plain background and generous margins. Lets the words carry the slide.' },
  { id: 'underline', label: 'Underline', blurb: 'A short accent bar under every title.' },
  { id: 'banded', label: 'Banded', blurb: 'Titles sit in a coloured band across the top; title slides get a band across the middle.' },
  { id: 'sidebar', label: 'Sidebar', blurb: 'A slim accent strip down the left edge.' },
  { id: 'split', label: 'Split', blurb: 'A tinted panel on the right; title slides are split into a colour block and text.' },
  { id: 'framed', label: 'Framed', blurb: 'A thin accent frame inset around every slide.' },
  { id: 'bold', label: 'Bold', blurb: 'Title, section and closing slides fill with the accent colour; other slides get a top rule.' },
  { id: 'corner', label: 'Corner', blurb: 'An accent triangle in the bottom corner and a soft dot top left.' },
];
const DESIGN_IDS = DESIGNS.map((d) => d.id);

const LAYOUTS = ['title', 'section', 'bullets', 'agenda', 'two-column', 'comparison', 'three-column', 'stats', 'quote', 'timeline', 'picture', 'full-picture', 'closing'];
const HERO = new Set(['title', 'section', 'closing']);

// Composition hints written by the deterministic design pass and carried on every canonical slide. plan() is the one
// place they become geometry, so HTML/PDF/PNG and PPTX stay identical.
const IMAGE_ROLES = ['hero', 'supporting', 'background', 'spotlight'];
const IMAGE_SIDES = ['left', 'right', 'top', 'bottom', 'full'];
const IMAGE_FITS = ['contain', 'cover'];
const FOCAL_POINTS = ['center', 'left', 'right', 'top', 'bottom'];
const DENSITIES = ['calm', 'balanced', 'dense'];
const EMPHASES = ['title', 'image', 'content', 'balanced'];
const VARIANTS = ['standard', 'editorial', 'feature', 'quote-led'];

const OBJECT_POSITION = {
  center: '50% 50%', left: '0% 50%', right: '100% 50%', top: '50% 0%', bottom: '50% 100%',
};

const ASPECT_RATIO = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1 };

const BODY = 30; // px on a 720px-tall slide (about 24pt in PowerPoint on a 4:3 slide)
const SMALL = 22;

const clean = (v) => String(v == null ? '' : v).trim();
const list = (v, n) => (Array.isArray(v) ? v.map(clean).filter(Boolean).slice(0, n) : []);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
function decodeInline(s) {
  return String(s || '').replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, (_, name) => ENTITIES[name.toLowerCase()] || _);
}

/** Tiny rich-text parser shared by HTML and PPTX. Only b/strong, i/em, u and br are meaningful. */
function richRuns(raw) {
  const source = clean(raw);
  if (!source) return [];
  const runs = [];
  let buf = '';
  const flags = { bold: false, italic: false, underline: false };
  const flush = () => {
    if (buf) runs.push({ text: decodeInline(buf), ...flags });
    buf = '';
  };
  const re = /<\s*(\/)?\s*(strong|b|i|em|u|br)\b[^>]*>/gi;
  let last = 0;
  let m = re.exec(source);
  while (m) {
    buf += source.slice(last, m.index);
    flush();
    const tag = m[2].toLowerCase();
    if (tag === 'br' && !m[1]) runs.push({ text: '\n', ...flags });
    else {
      const key = tag === 'strong' || tag === 'b' ? 'bold' : tag === 'i' || tag === 'em' ? 'italic' : 'underline';
      flags[key] = !m[1];
    }
    last = m.index + m[0].length;
    m = re.exec(source);
  }
  buf += source.slice(last);
  flush();
  return runs.filter((r) => r.text);
}

function richText(raw) {
  return richRuns(raw).map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
}

/** Columns for comparison / three-column / stats, falling back to the bullets when the slide has no columns. */
function columnsFor(slide, count) {
  const cols = Array.isArray(slide.columns) ? slide.columns.filter((c) => c && (clean(c.heading) || list(c.bullets, 6).length)) : [];
  if (cols.length) return cols.slice(0, count).map((c) => ({ heading: clean(c.heading), bullets: list(c.bullets, 5) }));
  const bullets = list(slide.bullets, 8);
  if (slide.layout === 'stats') {
    // "42% | Customer growth" or "42%: Customer growth" -> a big number and its label
    return bullets.slice(0, count).map((b) => {
      const m = b.match(/^(.{1,16}?)\s*[|:–—]\s*(.+)$/);
      return m ? { heading: m[1], bullets: [m[2]] } : { heading: b, bullets: [] };
    });
  }
  const per = Math.max(1, Math.ceil(bullets.length / count));
  return Array.from({ length: count }, (_, i) => ({ heading: '', bullets: bullets.slice(i * per, (i + 1) * per) })).filter((c) => c.bullets.length);
}

const rectAspect = (rect, ratio) => (rect.w / Math.max(0.01, rect.h)) * ratio;

/**
 * Source rectangle for a cover image. Focal points shift the crop instead of always cutting from the middle; PPTX can
 * use the pixel rectangle directly, while HTML uses object-position as the equivalent.
 */
function cropFor(hint, rect, ratio) {
  const width = Number(hint?.imageWidth) || 0;
  const height = Number(hint?.imageHeight) || 0;
  if (!width || !height || hint.imageFit !== 'cover') return null;
  const focal = FOCAL_POINTS.includes(hint.focalPoint) ? hint.focalPoint : 'center';
  const boxAspect = rectAspect(rect, ratio);
  const imageAspect = width / height;
  const round = (v) => Math.round(v * 100) / 100;
  let x = 0; let y = 0; let w = width; let h = height;
  if (imageAspect > boxAspect) {
    w = height * boxAspect;
    x = focal === 'left' ? 0 : focal === 'right' ? width - w : (width - w) / 2;
  } else if (imageAspect < boxAspect) {
    h = width / boxAspect;
    y = focal === 'top' ? 0 : focal === 'bottom' ? height - h : (height - h) / 2;
  }
  return { x: round(Math.max(0, Math.min(width - w, x))), y: round(Math.max(0, Math.min(height - h, y))), w: round(w), h: round(h) };
}

/** Decoration shapes and the content area for a design. */
function frameFor(designId, hero, ratio = 16 / 9) {
  const shapes = [];
  let area = { x: 7, y: 10, w: 86, h: 80 };
  let titleOnBand = false;
  let heroMode = 'centre'; // centre | band | block | fill
  switch (designId) {
    case 'banded':
      if (hero) { shapes.push({ kind: 'rect', x: 0, y: 34, w: 100, h: 32, fill: 'primary' }); heroMode = 'band'; } else {
        shapes.push({ kind: 'rect', x: 0, y: 0, w: 100, h: 21, fill: 'primary' });
        titleOnBand = true;
        area = { x: 7, y: 27, w: 86, h: 63 };
      }
      break;
    case 'sidebar':
      shapes.push({ kind: 'rect', x: 0, y: 0, w: 2.5, h: 100, fill: 'primary' });
      area = { x: 10, y: 10, w: 83, h: 80 };
      break;
    case 'split':
      if (hero) { shapes.push({ kind: 'rect', x: 0, y: 0, w: 46, h: 100, fill: 'primary' }); heroMode = 'block'; } else {
        shapes.push({ kind: 'rect', x: 74, y: 0, w: 26, h: 100, fill: 'primary', alpha: 0.14 });
        area = { x: 7, y: 10, w: 63, h: 80 };
      }
      break;
    case 'framed':
      shapes.push({ kind: 'rect', x: 3, y: 5, w: 94, h: 90, stroke: 'primary', strokeWidth: 2 });
      area = { x: 9, y: 13, w: 82, h: 74 };
      break;
    case 'bold':
      if (hero) { shapes.push({ kind: 'rect', x: 0, y: 0, w: 100, h: 100, fill: 'primary' }); heroMode = 'fill'; } else {
        shapes.push({ kind: 'rect', x: 0, y: 0, w: 100, h: 2.2, fill: 'primary' });
      }
      break;
    case 'corner':
      shapes.push({ kind: 'tri', x: 82, y: 70, w: 18, h: 30, fill: 'primary' });
      shapes.push({ kind: 'ellipse', x: 3, y: 4, w: 6 / ratio, h: 6, fill: 'primary', alpha: 0.25, round: true });
      area = { x: 7, y: 12, w: 80, h: 76 };
      break;
    default:
      break;
  }
  return { shapes, area, titleOnBand, heroMode, rule: designId === 'underline' || designId === 'corner' };
}

/**
 * Everything to draw for one slide: { shapes, boxes, images, number }.
 *   shape: { kind: rect|ellipse|tri, x, y, w, h, fill?, alpha?, stroke?, strokeWidth?, label?, labelColor?, labelSize? }
 *   box:   { x, y, w, h, text | bullets, size, bold?, italic?, color, align, valign }
 *   image: { x, y, w, h, ref, fit: contain|cover }
 * Colours are theme names: text, muted, primary, bg.
 */
function plan(slide, { designId = 'clean', aspect = '16:9', titleSize = 44 } = {}) {
  const layout = LAYOUTS.includes(slide.layout) ? slide.layout : 'bullets';
  const design = DESIGN_IDS.includes(designId) ? designId : 'clean';
  const ratio = ASPECT_RATIO[aspect] || ASPECT_RATIO['16:9'];
  const round = (h) => h / ratio; // width in % for a circle that is h% tall
  const hint = slide.design && typeof slide.design === 'object' ? slide.design : {};
  const focal = FOCAL_POINTS.includes(hint.focalPoint) ? hint.focalPoint : 'center';
  const scrim = Math.max(0, Math.min(0.85, Number(hint.scrim) || 0));
  const density = DENSITIES.includes(hint.density) ? hint.density : 'balanced';
  const variant = VARIANTS.includes(hint.variant) ? hint.variant : 'standard';
  const hero = HERO.has(layout);
  // A quote has no title to put on Banded's band, so it uses the plain frame instead of an empty band.
  const f = layout === 'quote' && design === 'banded' ? frameFor('clean', false, ratio) : frameFor(design, hero, ratio);
  const shapes = layout === 'full-picture' ? [] : [...f.shapes];
  const boxes = [];
  const images = [];
  const tSize = Math.max(24, Math.min(72, Number(titleSize) || 44));
  const rich = slide.rich || {};
  const title = richText(rich.title) || clean(slide.title);
  const body = richText(rich.body) || clean(slide.body);
  const bullets = Array.isArray(rich.bullets) && rich.bullets.length
    ? rich.bullets.slice(0, 6).map(richText).filter(Boolean)
    : list(slide.bullets, 6);

  /** Attach rich runs to the plain boxes the layout produced, so one geometry drives HTML and PPTX alike. */
  const attachRich = () => {
    if (!rich.title && !rich.body && !rich.bullets?.length) return;
    const titleHtml = clean(rich.title);
    const bodyHtml = clean(rich.body);
    const tBox = boxes.find((b) => b.text === title && titleHtml);
    if (tBox) { tBox.html = titleHtml; tBox.runs = richRuns(titleHtml); }
    const bBox = boxes.find((b) => b.text === body && bodyHtml);
    if (bBox) { bBox.html = bodyHtml; bBox.runs = richRuns(bodyHtml); }
    const htmls = Array.isArray(rich.bullets) ? rich.bullets.slice(0, 6).map(clean) : [];
    const bulletBox = boxes.find((b) => Array.isArray(b.bullets) && htmls.length
      && b.bullets.every((line, i) => richText(htmls[i]) === line));
    if (bulletBox) {
      bulletBox.htmls = htmls;
      bulletBox.runs = htmls.map((h) => [...richRuns(h), { text: '\n', bold: false, italic: false, underline: false }]).flat().slice(0, -1);
    }
  };

  /** Extra media on top of the layout: more pictures, user shapes, a chart and a table. */
  const addExtras = (result) => {
    attachRich();
    for (const im of (Array.isArray(slide.images) ? slide.images : [])) {
      images.push({ x: im.x, y: im.y, w: im.w, h: im.h, ref: im.ref, fit: im.fit || 'contain', focalPoint: 'center' });
    }
    for (const sh of (Array.isArray(slide.shapes) ? slide.shapes : [])) {
      shapes.push({ ...sh });
    }
    return { ...result, charts: slide.chart ? [{ ...slide.chart }] : [], tables: slide.table ? [{ ...slide.table }] : [] };
  };

  /** One composed picture with its focal crop and overlay scrim decisions attached. */
  const composedImage = (rect, fit, ref = slide.imageRef) => ({
    ...rect,
    ref,
    fit,
    focalPoint: focal,
    objectPosition: OBJECT_POSITION[focal],
    crop: cropFor({ ...hint, imageFit: fit }, rect, ratio),
  });

  // ---- hero slides: title, section, closing ----
  if (hero) {
    const big = (layout === 'section' ? tSize + 4 : tSize + 12) + (hint.emphasis === 'title' ? 4 : 0);
    const hasHeroImage = Boolean(clean(slide.imageRef));
    if (hasHeroImage) {
      // A hero picture is a background, not a sticker: it fills the slide and gets a scrim before any words are drawn.
      for (let i = shapes.length - 1; i >= 0; i -= 1) {
        if (shapes[i].fill === 'primary' && shapes[i].w === 100 && shapes[i].h === 100) shapes.splice(i, 1);
      }
      images.push(composedImage({ x: 0, y: 0, w: 100, h: 100 }, IMAGE_FITS.includes(hint.imageFit) ? hint.imageFit : 'cover'));
      shapes.push({ kind: 'rect', x: 0, y: 0, w: 100, h: 100, fill: 'text', alpha: scrim || 0.45, overlay: true });
    }
    if (f.heroMode === 'band') {
      boxes.push({ x: 7, y: 36, w: 86, h: 28, text: title, size: big, bold: true, color: 'bg', align: 'center', valign: 'middle' });
      if (body) boxes.push({ x: 10, y: 70, w: 80, h: 18, text: body, size: 30, color: hasHeroImage ? 'bg' : 'muted', align: 'center', valign: 'top' });
    } else if (f.heroMode === 'block') {
      boxes.push({ x: 5, y: 20, w: 37, h: 60, text: title, size: big, bold: true, color: 'bg', align: 'left', valign: 'middle' });
      if (body) boxes.push({ x: 52, y: 20, w: 41, h: 60, text: body, size: 30, color: hasHeroImage ? 'bg' : 'muted', align: 'left', valign: 'middle' });
    } else {
      const colour = hasHeroImage || f.heroMode === 'fill' ? 'bg' : 'text';
      const left = layout === 'section';
      const a = f.area;
      boxes.push({ x: a.x, y: a.y + a.h * 0.18, w: a.w, h: a.h * 0.38, text: title, size: big, bold: true, color: colour, align: left ? 'left' : 'center', valign: 'bottom' });
      if ((f.rule || layout === 'section') && !hasHeroImage) {
        const rw = 9;
        shapes.push({ kind: 'rect', x: left ? a.x : 50 - rw / 2, y: a.y + a.h * 0.6, w: rw, h: 1, fill: f.heroMode === 'fill' ? 'bg' : 'primary' });
      }
      if (body) boxes.push({ x: a.x, y: a.y + a.h * 0.66, w: a.w, h: a.h * 0.3, text: body, size: 30, color: hasHeroImage || f.heroMode === 'fill' ? 'bg' : 'muted', align: left ? 'left' : 'center', valign: 'top' });
    }
    return addExtras({ layout, design, shapes, boxes, images, number: false });
  }

  // ---- full-bleed picture with the title on a strip ----
  if (layout === 'full-picture') {
    const full = { x: 0, y: 0, w: 100, h: 100 };
    if (clean(slide.imageRef)) images.push(composedImage(full, IMAGE_FITS.includes(hint.imageFit) ? hint.imageFit : 'cover'));
    else shapes.push({ kind: 'rect', ...full, fill: 'primary', alpha: 0.18 });
    if (scrim) shapes.push({ kind: 'rect', ...full, fill: 'text', alpha: scrim, overlay: true });
    else shapes.push({ kind: 'rect', x: 0, y: 70, w: 100, h: 30, fill: 'text', alpha: 0.6, overlay: true });
    boxes.push({ x: 6, y: 72, w: 88, h: body ? 13 : 24, text: title, size: tSize, bold: true, color: 'bg', align: 'left', valign: body ? 'bottom' : 'middle' });
    if (body) boxes.push({ x: 6, y: 86, w: 88, h: 11, text: body, size: SMALL + 2, color: 'bg', align: 'left', valign: 'top' });
    return addExtras({ layout, design, shapes, boxes, images, number: false });
  }

  // ---- quote: no title bar, the body is the quote and the title is who said it ----
  if (layout === 'quote') {
    const a = f.area;
    boxes.push({ x: a.x, y: a.y, w: 14, h: 22, text: '“', size: 140, bold: true, color: 'primary', align: 'left', valign: 'top' });
    boxes.push({ x: a.x + 6, y: a.y + 16, w: a.w - 12, h: a.h * 0.56, text: body || title, size: 38, italic: true, color: 'text', align: 'left', valign: 'middle' });
    if (body && title) boxes.push({ x: a.x + 6, y: a.y + 16 + a.h * 0.6, w: a.w - 12, h: 10, text: `— ${title}`, size: SMALL + 4, color: 'muted', align: 'right', valign: 'top' });
    return addExtras({ layout, design, shapes, boxes, images, number: true });
  }

  // ---- every other layout: a title, then the content area ----
  const a = f.area;
  if (f.titleOnBand) boxes.push({ x: 7, y: 3, w: 86, h: 15, text: title, size: tSize, bold: true, color: 'bg', align: 'left', valign: 'middle' });
  else {
    boxes.push({ x: a.x, y: a.y, w: a.w, h: 14, text: title, size: tSize, bold: true, color: 'text', align: 'left', valign: 'bottom' });
    if (f.rule) shapes.push({ kind: 'rect', x: a.x, y: a.y + 15.5, w: 8, h: 1, fill: 'primary' });
  }
  const c = f.titleOnBand ? { x: a.x, y: a.y, w: a.w, h: a.h } : { x: a.x, y: a.y + 20, w: a.w, h: a.h - 20 };
  const gap = 4;
  const bodySize = density === 'dense' ? SMALL + 2 : density === 'calm' ? BODY + 2 : BODY;

  switch (layout) {
    case 'agenda': {
      const items = bullets.length ? bullets : (body ? [body] : []);
      const row = Math.min(14, c.h / Math.max(items.length, 1));
      const d = Math.min(row * 0.72, 9);
      items.forEach((item, i) => {
        const y = c.y + i * row;
        shapes.push({ kind: 'ellipse', x: c.x, y: y + (row - d) / 2, w: round(d), h: d, fill: 'primary', round: true, label: String(i + 1), labelColor: 'bg', labelSize: Math.max(14, d * 2.2) });
        boxes.push({ x: c.x + round(d) + 2.5, y, w: c.w - round(d) - 2.5, h: row, text: item, size: BODY, color: 'text', align: 'left', valign: 'middle' });
      });
      break;
    }
    case 'two-column': {
      const w = (c.w - gap) / 2;
      if (body) boxes.push({ x: c.x, y: c.y, w, h: c.h, text: body, size: bodySize, color: 'muted', align: 'left', valign: 'top' });
      if (bullets.length) boxes.push({ x: c.x + w + gap, y: c.y, w, h: c.h, bullets, size: bodySize, color: 'text', align: 'left', valign: 'top' });
      break;
    }
    case 'comparison':
    case 'three-column': {
      const n = layout === 'comparison' ? 2 : 3;
      const cols = columnsFor(slide, n);
      const w = (c.w - gap * (n - 1)) / n;
      cols.forEach((col, i) => {
        const x = c.x + i * (w + gap);
        if (layout === 'three-column') shapes.push({ kind: 'rect', x, y: c.y, w, h: c.h, fill: 'primary', alpha: 0.08 });
        const pad = layout === 'three-column' ? 2 : 0;
        if (col.heading) {
          boxes.push({ x: x + pad, y: c.y + 2, w: w - pad * 2, h: 10, text: col.heading, size: BODY + 2, bold: true, color: 'primary', align: 'left', valign: 'middle' });
          if (layout === 'comparison') shapes.push({ kind: 'rect', x, y: c.y + 13, w, h: 0.6, fill: 'primary' });
        }
        const top = col.heading ? 16 : 3;
        if (col.bullets.length) boxes.push({ x: x + pad, y: c.y + top, w: w - pad * 2, h: c.h - top - 2, bullets: col.bullets, size: n === 3 ? SMALL + 2 : BODY, color: 'text', align: 'left', valign: 'top' });
      });
      if (body && layout === 'comparison') boxes.push({ x: c.x, y: c.y + c.h - 9, w: c.w, h: 9, text: body, size: SMALL, color: 'muted', align: 'left', valign: 'bottom' });
      break;
    }
    case 'stats': {
      const cols = columnsFor(slide, 4);
      const n = Math.max(cols.length, 1);
      const w = (c.w - gap * (n - 1)) / n;
      cols.forEach((col, i) => {
        const x = c.x + i * (w + gap);
        boxes.push({ x, y: c.y + c.h * 0.12, w, h: c.h * 0.4, text: col.heading, size: n > 3 ? 54 : 66, bold: true, color: 'primary', align: 'center', valign: 'bottom' });
        if (col.bullets[0]) boxes.push({ x, y: c.y + c.h * 0.55, w, h: c.h * 0.3, text: col.bullets[0], size: SMALL + 2, color: 'muted', align: 'center', valign: 'top' });
      });
      if (body) boxes.push({ x: c.x, y: c.y + c.h - 10, w: c.w, h: 10, text: body, size: SMALL, color: 'muted', align: 'center', valign: 'bottom' });
      break;
    }
    case 'timeline': {
      const items = bullets.length ? bullets : (body ? [body] : []);
      const n = Math.max(items.length, 1);
      const lineY = c.y + c.h * 0.42;
      shapes.push({ kind: 'rect', x: c.x, y: lineY, w: c.w, h: 0.7, fill: 'muted', alpha: 0.5 });
      const slot = c.w / n;
      const d = 4;
      items.forEach((item, i) => {
        const cx = c.x + slot * i + slot / 2;
        shapes.push({ kind: 'ellipse', x: cx - round(d) / 2, y: lineY + 0.35 - d / 2, w: round(d), h: d, fill: 'primary', round: true });
        const m = item.match(/^(.{1,24}?)\s*[|:–—]\s*(.+)$/);
        if (m) boxes.push({ x: cx - slot / 2 + 1, y: lineY - 16, w: slot - 2, h: 12, text: m[1], size: SMALL + 2, bold: true, color: 'primary', align: 'center', valign: 'bottom' });
        boxes.push({ x: cx - slot / 2 + 1, y: lineY + 5, w: slot - 2, h: c.h * 0.5, text: m ? m[2] : item, size: n > 4 ? SMALL - 2 : SMALL, color: 'text', align: 'center', valign: 'top' });
      });
      break;
    }
    case 'picture': {
      const hasImage = Boolean(clean(slide.imageRef));
      const role = IMAGE_ROLES.includes(hint.imageRole) ? hint.imageRole : 'supporting';
      const fit = IMAGE_FITS.includes(hint.imageFit) ? hint.imageFit : (role === 'supporting' ? 'contain' : 'cover');
      const side = IMAGE_SIDES.includes(hint.imageSide) ? hint.imageSide : 'right';
      if (hasImage && role === 'background') {
        const full = { x: 0, y: 0, w: 100, h: 100 };
        images.push(composedImage(full, IMAGE_FITS.includes(hint.imageFit) ? hint.imageFit : 'cover'));
        shapes.push({ kind: 'rect', ...full, fill: 'text', alpha: scrim || 0.5, overlay: true });
        boxes.push({ x: 6, y: 62, w: 88, h: 18, text: title, size: tSize, bold: true, color: 'bg', align: 'left', valign: 'bottom' });
        if (body) boxes.push({ x: 6, y: 80, w: 88, h: 14, text: body, size: SMALL + 2, color: 'bg', align: 'left', valign: 'top' });
        break;
      }
      const emphasis = hint.emphasis;
      let share = role === 'hero' || emphasis === 'image' ? 0.62
        : role === 'spotlight' ? 0.56 : emphasis === 'content' ? 0.42 : 0.48;
      share = Math.max(0.34, Math.min(0.68, share));
      let ir; let tr;
      if (side === 'top' || side === 'bottom') {
        const ih = c.h * share;
        if (side === 'top') {
          ir = { x: c.x, y: c.y, w: c.w, h: ih };
          tr = { x: c.x, y: c.y + ih + gap, w: c.w, h: c.h - ih - gap };
        } else {
          tr = { x: c.x, y: c.y, w: c.w, h: c.h - ih - gap };
          ir = { x: c.x, y: tr.y + tr.h + gap, w: c.w, h: ih };
        }
      } else {
        const iw = (c.w - gap) * share;
        if (side === 'left') {
          ir = { x: c.x, y: c.y, w: iw, h: c.h };
          tr = { x: c.x + iw + gap, y: c.y, w: c.w - iw - gap, h: c.h };
        } else {
          tr = { x: c.x, y: c.y, w: c.w - iw - gap, h: c.h };
          ir = { x: tr.x + tr.w + gap, y: c.y, w: iw, h: c.h };
        }
      }
      if (hasImage) images.push(composedImage(ir, fit));
      else shapes.push({ kind: 'rect', ...ir, fill: 'primary', alpha: 0.1 });
      if (variant === 'editorial') {
        shapes.push({ kind: 'rect', x: Math.min(99, tr.x - (side === 'right' ? 1.5 : 0)), y: tr.y, w: 0.8, h: tr.h, fill: 'primary', alpha: 0.8 });
      }
      const textSize = density === 'dense' ? SMALL : BODY;
      if (bullets.length) boxes.push({ ...tr, h: body ? tr.h * 0.6 : tr.h, bullets, size: textSize, color: 'text', align: 'left', valign: 'top' });
      if (body) boxes.push({
        ...tr,
        y: bullets.length ? tr.y + tr.h * 0.63 : tr.y,
        h: bullets.length ? tr.h * 0.37 : tr.h,
        text: body,
        size: bullets.length ? SMALL : textSize,
        color: 'muted', align: 'left', valign: 'top',
      });
      break;
    }
    default: { // bullets
      if (bullets.length) boxes.push({ x: c.x, y: c.y, w: c.w, h: body ? c.h * 0.7 : c.h, bullets, size: bodySize + 2, color: 'text', align: 'left', valign: 'top' });
      if (body) boxes.push({ x: c.x, y: bullets.length ? c.y + c.h * 0.74 : c.y, w: c.w, h: bullets.length ? c.h * 0.26 : c.h, text: body, size: bullets.length ? SMALL + 2 : bodySize + 2, color: 'muted', align: 'left', valign: 'top' });
    }
  }
  return addExtras({ layout, design, shapes, boxes, images, number: true });
}

module.exports = {
  DESIGNS, DESIGN_IDS, LAYOUTS, HERO, ASPECT_RATIO, IMAGE_ROLES, IMAGE_SIDES, IMAGE_FITS, FOCAL_POINTS, DENSITIES, EMPHASES, VARIANTS,
  plan, columnsFor, cropFor, richRuns, richText,
};
