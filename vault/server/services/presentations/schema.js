'use strict';

// Canonical Presentations data shapes. Every generator, editor and exporter goes through here.
// See docs/presentations.md.

// The slide layouts and design styles live with their geometry (layouts.js), shared by the preview and every export.
const { LAYOUTS, DESIGN_IDS, DESIGNS } = require('./layouts');
// How the full-screen slideshow moves between slides (client Slideshow.jsx). Kept on the deck so a saved deck remembers it.
const TRANSITIONS = ['none', 'fade', 'push', 'wipe', 'zoom'];
const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'line'];
const SHAPE_COLOURS = ['bg', 'text', 'primary', 'muted'];
const CHART_TYPES = ['bar', 'line', 'pie'];
const MIN_SLIDES = 6;
const MAX_SLIDES = 20;
const DEFAULT_SLIDES = 10;
const SOURCE_MAX = 24000;

const BUILTIN_THEMES = [
  { id: 'paper', label: 'Paper', bg: '#ffffff', text: '#1f2937', primary: '#9B5B46', muted: '#6b7280', font: 'Arial, sans-serif', titleSize: 44, showLogo: false },
  { id: 'ink', label: 'Ink', bg: '#111827', text: '#f9fafb', primary: '#f59e0b', muted: '#9ca3af', font: 'Georgia, serif', titleSize: 46, showLogo: false },
  { id: 'warm', label: 'Warm', bg: '#fff7ed', text: '#431407', primary: '#c2410c', muted: '#7c2d12', font: 'Arial, sans-serif', titleSize: 42, showLogo: false },
  { id: 'ocean', label: 'Ocean', bg: '#f0f9ff', text: '#0c4a6e', primary: '#0284c7', muted: '#0369a1', font: 'Verdana, sans-serif', titleSize: 42, showLogo: false },
  { id: 'forest', label: 'Forest', bg: '#f0fdf4', text: '#14532d', primary: '#16a34a', muted: '#166534', font: 'Georgia, serif', titleSize: 42, showLogo: false },
  { id: 'mono', label: 'Mono', bg: '#fafafa', text: '#171717', primary: '#404040', muted: '#525252', font: 'Courier New, monospace', titleSize: 40, showLogo: false },
];

const THEME_KEYS = ['id', 'label', 'bg', 'text', 'primary', 'muted', 'font', 'titleSize', 'showLogo'];

class PresentationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

function text(value, max = 500) {
  return String(value == null ? '' : value).replace(/\r/g, '').trim().slice(0, max);
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function hexColour(value, fallback = '') {
  const s = String(value == null ? '' : value).trim();
  return HEX.test(s) ? s : fallback;
}

/** Keep only the inline tags render.js and export.js both understand. Everything else is escaped, never executed. */
function sanitizeRich(value, max = 1200) {
  const raw = text(value, max * 2);
  if (!raw) return '';
  return raw
    .replace(/<\s*\/?\s*(?!b\b|strong\b|i\b|em\b|u\b|br\b)[^>]*>/gi, '')
    .slice(0, max);
}

function stripRich(value) {
  return String(value == null ? '' : value)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

/** Built-in theme by id, or a validated custom theme object. Unknown ids fall back to Paper. */
function resolveTheme(themeOrId) {
  const id = typeof themeOrId === 'string' ? themeOrId : themeOrId?.id;
  const builtin = BUILTIN_THEMES.find((t) => t.id === id);
  if (builtin && typeof themeOrId === 'string') return builtin;
  if (!themeOrId || typeof themeOrId !== 'object') return BUILTIN_THEMES[0];
  const base = builtin || BUILTIN_THEMES[0];
  const out = { ...base };
  for (const key of THEME_KEYS) {
    if (themeOrId[key] === undefined) continue;
    if (['bg', 'text', 'primary', 'muted'].includes(key)) {
      if (HEX.test(String(themeOrId[key]))) out[key] = String(themeOrId[key]);
    } else if (key === 'titleSize') {
      out[key] = clampInt(themeOrId[key], base.titleSize, 24, 72);
    } else if (key === 'showLogo') {
      out.showLogo = Boolean(themeOrId.showLogo);
    } else {
      out[key] = text(themeOrId[key], 120) || base[key];
    }
  }
  return out;
}

/** Sanitize a theme for saving as a custom template. The id is not trusted from the browser. */
function sanitizeCustomTheme(input) {
  const base = resolveTheme(input);
  return {
    ...base,
    id: `custom-${Date.now().toString(36)}`,
    label: text(input?.label, 60) || 'My theme',
    showLogo: Boolean(input?.showLogo),
  };
}

/** Up to four columns (comparison uses 2, three-column 3, stats up to 4): a heading and a few short bullets each. */
function normalizeColumns(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).map((c) => ({
    heading: text(c?.heading, 80),
    bullets: Array.isArray(c?.bullets) ? c.bullets.map((b) => text(b, 160)).filter(Boolean).slice(0, 5) : [],
  })).filter((c) => c.heading || c.bullets.length);
}

function normalizeExtraImages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((im, i) => ({
    id: text(im?.id, 60) || `img${i + 1}`,
    ref: text(im?.ref, 4 * 1024 * 1024),
    x: clampNumber(im?.x, 55, 0, 100),
    y: clampNumber(im?.y, 20, 0, 100),
    w: clampNumber(im?.w, 36, 1, 100),
    h: clampNumber(im?.h, 36, 1, 100),
    fit: ['contain', 'cover'].includes(im?.fit) ? im.fit : 'contain',
  })).filter((im) => im.ref);
}

function normalizeShapes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 16).map((sh, i) => ({
    id: text(sh?.id, 60) || `shape${i + 1}`,
    kind: SHAPE_KINDS.includes(sh?.kind) ? sh.kind : 'rect',
    x: clampNumber(sh?.x, 10, 0, 100),
    y: clampNumber(sh?.y, 10, 0, 100),
    w: clampNumber(sh?.w, 20, 1, 100),
    h: clampNumber(sh?.h, 12, 1, 100),
    fill: SHAPE_COLOURS.includes(sh?.fill) ? sh.fill : 'primary',
    stroke: SHAPE_COLOURS.includes(sh?.stroke) ? sh.stroke : '',
    strokeWidth: clampInt(sh?.strokeWidth, 1, 0, 8),
    alpha: clampNumber(sh?.alpha, 0.15, 0, 1),
    rotation: clampNumber(sh?.rotation, 0, -180, 180),
  }));
}

function normalizeChart(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const series = Array.isArray(raw.series) ? raw.series.slice(0, 6).map((s, i) => ({
    name: text(s?.name, 60) || `Series ${i + 1}`,
    values: Array.isArray(s?.values) ? s.values.slice(0, 12).map((v) => clampNumber(v, 0, -1000000, 1000000)) : [],
  })).filter((s) => s.values.length) : [];
  if (!series.length) return null;
  return {
    type: CHART_TYPES.includes(raw.type) ? raw.type : 'bar',
    title: text(raw.title, 120),
    labels: Array.isArray(raw.labels) ? raw.labels.slice(0, 12).map((l) => text(l, 60)) : [],
    series,
    x: clampNumber(raw.x, 8, 0, 100),
    y: clampNumber(raw.y, 25, 0, 100),
    w: clampNumber(raw.w, 84, 10, 100),
    h: clampNumber(raw.h, 55, 10, 100),
  };
}

function normalizeTable(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows)) return null;
  const rows = raw.rows.slice(0, 12).map((row) => (Array.isArray(row) ? row : []).slice(0, 8).map((cell) => text(cell, 160)));
  if (!rows.length || !rows.some((row) => row.some(Boolean))) return null;
  return {
    rows,
    header: raw.header !== false,
    x: clampNumber(raw.x, 8, 0, 100),
    y: clampNumber(raw.y, 25, 0, 100),
    w: clampNumber(raw.w, 84, 10, 100),
    h: clampNumber(raw.h, 55, 10, 100),
  };
}

function normalizeRich(raw, bullets) {
  const value = {
    title: sanitizeRich(raw?.title, 500),
    body: sanitizeRich(raw?.body, 1200),
    bullets: Array.isArray(raw?.bullets) ? raw.bullets.slice(0, 6).map((b) => sanitizeRich(b, 500)).filter(Boolean) : [],
  };
  if (!value.title && !value.body && !value.bullets.length) {
    const fallback = {
      title: text(bullets?.title || raw?.title, 500),
      body: text(raw?.body, 1200),
      bullets: Array.isArray(raw?.bullets) ? raw.bullets.map((b) => text(b, 500)) : [],
    };
    return fallback.title || fallback.body || fallback.bullets.length ? fallback : null;
  }
  return value;
}

function normalizeSlide(raw, index) {
  const layout = LAYOUTS.includes(raw?.layout) ? raw.layout : 'bullets';
  const bullets = Array.isArray(raw?.bullets)
    ? raw.bullets.map((b) => text(b, 220)).filter(Boolean).slice(0, 6)
    : [];
  return {
    id: text(raw?.id, 60) || `s${index + 1}`,
    layout,
    title: text(raw?.title, 120),
    bullets,
    body: text(raw?.body, 700),
    columns: normalizeColumns(raw?.columns),
    imageRef: text(raw?.imageRef, 4 * 1024 * 1024),
    notes: text(raw?.notes, 1200),
    background: hexColour(raw?.background),
    imagePrompt: text(raw?.imagePrompt, 300),
    images: normalizeExtraImages(raw?.images),
    shapes: normalizeShapes(raw?.shapes),
    chart: normalizeChart(raw?.chart),
    table: normalizeTable(raw?.table),
    rich: normalizeRich(raw?.rich, { title: raw?.title, bullets: raw?.bullets }),
  };
}

/** Validate and clamp a full deck. Throws PresentationError on anything structurally wrong. */
function normalizeDeck(input, { allowSlides = MIN_SLIDES } = {}) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.slides)) {
    throw new PresentationError('That is not a presentation deck.', 400);
  }
  if (!input.slides.length) throw new PresentationError('A deck needs at least one slide.', 400);
  if (input.slides.length > MAX_SLIDES) {
    throw new PresentationError(`A deck can have at most ${MAX_SLIDES} slides.`, 400);
  }
  const slides = input.slides.map(normalizeSlide);
  const aspect = ['16:9', '4:3', '1:1'].includes(input.aspect) ? input.aspect : '16:9';
  return {
    schemaVersion: 2,
    title: text(input.title, 160) || 'Untitled presentation',
    subtitle: text(input.subtitle, 240),
    themeId: text(input.themeId, 80) || 'paper',
    designId: DESIGN_IDS.includes(input.designId) ? input.designId : 'clean',
    transition: TRANSITIONS.includes(input.transition) ? input.transition : 'fade',
    aspect,
    audience: text(input.audience, 160),
    tone: text(input.tone, 80),
    duration: clampInt(input.duration ?? 12, 12, 1, 180),
    nSlides: clampInt(input.nSlides ?? slides.length, slides.length, MIN_SLIDES, MAX_SLIDES),
    outline: Array.isArray(input.outline)
      ? normalizeOutline({ slides: input.outline, nSlides: Math.max(MIN_SLIDES, input.outline.length) }).slides.slice(0, input.outline.length)
      : [],
    slides,
  };
}

/** Build a simple deck deterministically from an outline. Used as a fallback if a model returns unusable JSON. */
function deckFromOutline(outline, themeId = 'paper', designId = 'clean') {
  const slides = (outline?.slides || []).slice(0, MAX_SLIDES).map((s, i) => ({
    id: `s${i + 1}`,
    layout: i === 0 ? 'title' : (s.layout || (s.imageRef ? 'picture' : 'bullets')),
    title: text(s.title, 120),
    bullets: (s.bullets || []).map((b) => text(b, 220)).filter(Boolean).slice(0, 6),
    body: text(s.body, 700),
    columns: s.columns,
    imageRef: text(s.imageRef, 4 * 1024 * 1024),
    imagePrompt: text(s.imagePrompt, 300),
    notes: text(s.notes, 1200),
  }));
  if (!slides.length) slides.push({ id: 's1', layout: 'title', title: text(outline?.title, 120) || 'Presentation', bullets: [], body: '', imageRef: '', notes: '' });
  return normalizeDeck({
    title: outline?.title,
    subtitle: outline?.subtitle,
    themeId,
    designId,
    aspect: outline?.aspect || '16:9',
    audience: outline?.audience,
    tone: outline?.tone,
    duration: outline?.duration,
    nSlides: outline?.nSlides || slides.length,
    outline: outline?.slides || [],
    slides,
  });
}

function normalizeOutline(raw) {
  const source = Array.isArray(raw?.slides) ? raw.slides : [];
  const wanted = clampInt(raw?.nSlides, Math.min(DEFAULT_SLIDES, Math.max(MIN_SLIDES, source.length || DEFAULT_SLIDES)), MIN_SLIDES, MAX_SLIDES);
  const slides = source.slice(0, wanted).map((s, i) => {
    const layout = LAYOUTS.includes(s?.layout) ? s.layout : (i === 0 ? 'title' : 'bullets');
    return {
      layout,
      title: text(s?.title, 120) || `Slide ${i + 1}`,
      bullets: Array.isArray(s?.bullets) ? s.bullets.map((b) => text(b, 220)).filter(Boolean).slice(0, 5) : [],
      body: text(s?.body, 700),
      columns: normalizeColumns(s?.columns),
      imageRef: text(s?.imageRef, 4 * 1024 * 1024),
      imagePrompt: text(s?.imagePrompt, 300),
      notes: text(s?.notes, 1200),
    };
  });
  while (slides.length < wanted) {
    slides.push({ layout: 'bullets', title: `Slide ${slides.length + 1}`, bullets: [], body: '', imageRef: '', imagePrompt: '', notes: '' });
  }
  return {
    title: text(raw?.title, 160) || 'Presentation',
    subtitle: text(raw?.subtitle, 240),
    nSlides: wanted,
    aspect: ['16:9', '4:3', '1:1'].includes(raw?.aspect) ? raw.aspect : '16:9',
    audience: text(raw?.audience, 160),
    tone: text(raw?.tone, 80),
    duration: clampInt(raw?.duration ?? 12, 12, 1, 180),
    slides,
  };
}

module.exports = {
  SOURCE_MAX,
  LAYOUTS, DESIGNS, DESIGN_IDS, TRANSITIONS, SHAPE_KINDS, SHAPE_COLOURS, CHART_TYPES, MIN_SLIDES, MAX_SLIDES, DEFAULT_SLIDES, BUILTIN_THEMES, PresentationError,
  text, clampInt, clampNumber, hexColour, sanitizeRich, stripRich, resolveTheme, sanitizeCustomTheme, normalizeDeck, normalizeSlide, normalizeColumns,
  deckFromOutline, normalizeOutline,
};
