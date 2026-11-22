'use strict';

// Canonical Presentations data shapes. Every generator, editor and exporter goes through here.
// See docs/presentations.md.

// The slide layouts and design styles live with their geometry (layouts.js), shared by the preview and every export.
const { LAYOUTS, DESIGN_IDS, DESIGNS } = require('./layouts');
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
    notes: text(raw?.notes, 600),
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
    schemaVersion: 1,
    title: text(input.title, 160) || 'Untitled presentation',
    subtitle: text(input.subtitle, 240),
    themeId: text(input.themeId, 80) || 'paper',
    designId: DESIGN_IDS.includes(input.designId) ? input.designId : 'clean',
    aspect,
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
    notes: '',
  }));
  if (!slides.length) slides.push({ id: 's1', layout: 'title', title: text(outline?.title, 120) || 'Presentation', bullets: [], body: '', imageRef: '', notes: '' });
  return normalizeDeck({
    schemaVersion: 1,
    title: outline?.title,
    subtitle: outline?.subtitle,
    themeId,
    designId,
    aspect: outline?.aspect || '16:9',
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
    };
  });
  while (slides.length < wanted) {
    slides.push({ layout: 'bullets', title: `Slide ${slides.length + 1}`, bullets: [], body: '', imageRef: '' });
  }
  return {
    title: text(raw?.title, 160) || 'Presentation',
    subtitle: text(raw?.subtitle, 240),
    nSlides: wanted,
    aspect: ['16:9', '4:3', '1:1'].includes(raw?.aspect) ? raw.aspect : '16:9',
    slides,
  };
}

module.exports = {
  SOURCE_MAX,
  LAYOUTS, DESIGNS, DESIGN_IDS, MIN_SLIDES, MAX_SLIDES, DEFAULT_SLIDES, BUILTIN_THEMES, PresentationError,
  text, clampInt, resolveTheme, sanitizeCustomTheme, normalizeDeck, normalizeSlide, normalizeColumns,
  deckFromOutline, normalizeOutline,
};
