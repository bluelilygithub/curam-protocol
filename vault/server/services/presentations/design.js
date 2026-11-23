'use strict';

// Deterministic composition pass for Presentations. It never calls a model and never changes the words: it reads the
// slide content, the image role and (where the bytes are owned) the picture's real aspect, then writes canonical design
// hints and a better-fitting layout. plan() turns those hints into geometry for HTML/PDF/PNG and PPTX alike.

const fs = require('fs/promises');
const {
  normalizeDeck, clampNumber,
} = require('./schema');
const {
  LAYOUTS, HERO, IMAGE_ROLES, IMAGE_SIDES, IMAGE_FITS, FOCAL_POINTS, DENSITIES, EMPHASES, VARIANTS, richText,
} = require('./layouts');
const { assetPath } = require('./sources');

const OWNED_ASSET = /^\/api\/presentations\/assets\/\d+\/([A-Za-z0-9._-]+)$/;
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,([A-Za-z0-9+/=\s]+)$/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const words = (value) => String(value || '').trim().split(/\s+/).filter(Boolean);

// A tiny wrapper keeps the text helpers below honest without reaching into rich runs again.
const rich = {
  bullets: (slide) => (Array.isArray(slide.rich?.bullets) && slide.rich.bullets.length
    ? slide.rich.bullets.map(richText).filter(Boolean)
    : slide.bullets || []),
};

function imageSize(buffer) {
  if (!buffer || buffer.length < 16) return null;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    for (let i = 2; i < buf.length - 9; i += 1) {
      if (buf[i] !== 0xff) continue;
      const marker = buf[i + 1];
      if (sof.has(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = buf.readUInt16BE(i + 2);
      if (length < 2) break;
      i += length + 1;
    }
  }
  if (buf.toString('ascii', 0, 3) === 'GIF' && buf.length >= 10) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X' && buf.length >= 30) {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (kind === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
  }
  return null;
}

/** Read owned bytes for their real dimensions. Public URLs are left alone; the design pass never fetches the network. */
async function pictureInfo(ref, userId, deps = {}) {
  const value = String(ref || '');
  const readFile = deps.readFile || fs.readFile;
  let bytes = null;
  const owned = OWNED_ASSET.exec(value);
  if (owned && userId) bytes = await readFile(assetPath(userId, owned[1])).catch(() => null);
  if (!bytes) {
    const data = DATA_IMAGE.exec(value);
    if (data) bytes = Buffer.from(data[1].replace(/\s/g, ''), 'base64');
  }
  const size = imageSize(bytes);
  if (!size || !size.width || !size.height) return { width: 0, height: 0, aspect: 0 };
  return { ...size, aspect: Math.round((size.width / size.height) * 1000) / 1000 };
}

function textProfile(slide) {
  const title = richText(slide.rich?.title) || slide.title || '';
  const body = richText(slide.rich?.body) || slide.body || '';
  const bullets = rich.bullets(slide).map((b) => richText(b) || b);
  const text = [title, body, ...bullets].join(' ');
  const count = words(text).length;
  return {
    title, body, bullets, text,
    count,
    density: count > 85 ? 'dense' : count < 32 ? 'calm' : 'balanced',
    short: text.length < 70,
  };
}

/** Pick a layout that suits the content. Words, image refs and notes are never touched. */
function chooseLayout(slide, index, profile) {
  const base = LAYOUTS.includes(slide.layout) ? slide.layout : 'bullets';
  if (HERO.has(base)) return base;
  // A main picture must stay on an image layout: stats/timeline/comparison never draw imageRef, and full-picture drops
  // bullets. Keep every word visible by choosing between the two image layouts on whether there is text beside the image.
  if (slide.imageRef) {
    const hasText = profile.bullets.length > 0 || profile.body.length > 40;
    return hasText ? 'picture' : 'full-picture';
  }
  const columns = Array.isArray(slide.columns) ? slide.columns.filter((c) => c && (c.heading || c.bullets?.length)) : [];
  const text = profile.text.toLowerCase();
  if (columns.length === 2 || /\bversus\b|\bvs\.?\b|pros and cons|before and after/.test(text)) return 'comparison';
  if (columns.length >= 3) return 'three-column';
  const dated = profile.bullets.filter((b) => /(19|20)\d{2}|\bq[1-4]\b|\bstep\b|\bphase\b|\bday\b|→/i.test(b)).length;
  if (dated >= 2) return 'timeline';
  if (/\bagenda\b|\broadmap\b|what we('|’)?ll cover|\bcontents\b/i.test(profile.title) && profile.bullets.length >= 3) return 'agenda';
  const numeric = profile.bullets.filter((b) => /^.{1,14}\s*[|:–—]\s*.+$/.test(b)).length;
  if (numeric >= 2 || /\bmetrics\b|\bkpis?\b|\bby the numbers\b/i.test(profile.title)) return 'stats';
  if (/\bquote\b|“/.test(profile.title + ' ' + profile.body) && profile.body.length < 200) return 'quote';
  if (base === 'picture' || base === 'full-picture') return 'bullets';
  return base;
}

function focalFromContent(slide, profile) {
  const subject = `${slide.imagePrompt || ''} ${profile.text}`.toLowerCase();
  if (/portrait|face|person|people|headshot|speaker|team photo/.test(subject)) return 'top';
  if (/sky|horizon|mountain|sun|cloud/.test(subject)) return 'top';
  if (/floor|ground|road|tabletop|foreground/.test(subject)) return 'bottom';
  return 'center';
}

function pick(list, value, fallback) { return list.includes(value) ? value : fallback; }

/** The full hint set for one slide, deterministic from index so decks alternate sides instead of repeating one shape. */
function composeSlide(slide, index, profile, info) {
  const layout = chooseLayout(slide, index, profile);
  const hero = HERO.has(layout);
  const role = hero || layout === 'full-picture' ? 'background'
    : info.aspect && info.aspect < 1.15 ? 'spotlight' : 'supporting';
  const side = role === 'background' ? 'full' : (index % 2 === 0 ? 'right' : 'left');
  const fit = role === 'supporting' && info.aspect > 1.6 ? 'contain' : 'cover';
  const variant = layout === 'quote' ? 'quote-led'
    : role === 'background' ? 'feature'
      : index % 3 === 1 ? 'editorial' : VARIANTS[0];
  const emphasis = hero || role === 'background' ? 'image'
    : role === 'hero' || role === 'spotlight' ? 'image'
      : profile.bullets.length > 2 ? 'content' : 'balanced';
  const scrim = role === 'background' ? (profile.count > 55 ? 0.52 : 0.42)
    : fit === 'cover' ? 0.14 : 0;
  return {
    imageRole: pick(IMAGE_ROLES, role, 'supporting'),
    imageSide: pick(IMAGE_SIDES, side, 'right'),
    imageFit: pick(IMAGE_FITS, fit, 'contain'),
    focalPoint: pick(FOCAL_POINTS, focalFromContent(slide, profile), 'center'),
    scrim: clampNumber(scrim, 0, 0, 0.85),
    density: pick(DENSITIES, profile.density, 'balanced'),
    emphasis: pick(EMPHASES, emphasis, 'balanced'),
    variant: pick(VARIANTS, variant, VARIANTS[0]),
    imageAspect: info.aspect || 0,
    imageWidth: info.width || 0,
    imageHeight: info.height || 0,
  };
}

/** A readable 0-100 composition score. The remix route shows the average change so the pass is inspectable. */
function scoreSlide(slide) {
  const profile = textProfile(slide);
  const hint = slide.design || {};
  let score = 54;
  if (!slide.imageRef) score += 6;
  if (IMAGE_ROLES.includes(hint.imageRole)) score += 7;
  if (IMAGE_SIDES.includes(hint.imageSide)) score += 5;
  if (IMAGE_FITS.includes(hint.imageFit)) score += 5;
  if (FOCAL_POINTS.includes(hint.focalPoint)) score += 4;
  if (DENSITIES.includes(hint.density)) score += 5;
  if (EMPHASES.includes(hint.emphasis)) score += 4;
  if (VARIANTS.includes(hint.variant) && hint.variant !== 'standard') score += 4;
  if (slide.imageRef && hint.imageRole === 'background' && hint.scrim >= 0.25) score += 6;
  if (slide.imageRef && hint.imageAspect) score += 5;
  const textFits = profile.bullets.length <= 5 && profile.body.length <= 260;
  score += textFits ? 9 : -8;
  const layoutFits = hint.imageRole === 'background'
    ? ['title', 'section', 'closing', 'full-picture'].includes(slide.layout) || (slide.layout === 'picture' && hint.imageSide === 'full')
    : !['full-picture'].includes(slide.layout);
  score += layoutFits ? 8 : -6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Apply the design pass to a canonical deck. Returns the new deck, the average before/after score, and short notes
 * naming the slides whose composition changed materially.
 */
async function remixDeck(input, { userId, deps = {} } = {}) {
  const deck = normalizeDeck(input);
  const slides = [];
  const before = [];
  const after = [];
  const notes = [];
  for (let index = 0; index < deck.slides.length; index += 1) {
    const slide = deck.slides[index];
    // eslint-disable-next-line no-await-in-loop
    const info = slide.imageRef ? await pictureInfo(slide.imageRef, userId, deps) : { width: 0, height: 0, aspect: 0 };
    const profile = textProfile(slide);
    const design = composeSlide(slide, index, profile, info);
    const next = { ...slide, layout: chooseLayout(slide, index, profile), design };
    // Compare against an undressed slide: normalizeDeck always supplies default hints, which would flatter the baseline.
    before.push(scoreSlide({ ...slide, design: {} }));
    after.push(scoreSlide(next));
    if (next.layout !== slide.layout && notes.length < 6) {
      notes.push(`Slide ${index + 1}: ${slide.layout} → ${next.layout}`);
    }
    slides.push(next);
  }
  const average = (values) => Math.round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length));
  return {
    deck: { ...deck, slides },
    score: average(after),
    previousScore: average(before),
    improvements: notes,
  };
}

module.exports = {
  imageSize, pictureInfo, textProfile, chooseLayout, composeSlide, focalFromContent, scoreSlide, remixDeck,
};
