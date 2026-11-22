'use strict';

// Turn uploaded documents, a public web page or pictures into source material for a deck. Nothing here talks to a model.
// Pictures are written under {UPLOAD_DIR}/presentations/<userId>/ and are referred to by a small, owned API path.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const { fetchPublicFile } = require('../../utils/safeFetch');
const { SOURCE_MAX, MAX_SLIDES } = require('./schema');
const { PresentationError, text, normalizeDeck } = require('./schema');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads');
const ASSET_ROOT = path.join(UPLOAD_DIR, 'presentations');
const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const IMAGE_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
};
const IMAGE_MIME_FROM_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
};
const PRESENTATION_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
]);

function assetDir(userId) { return path.join(ASSET_ROOT, String(userId)); }

/** Validate a path segment from a URL before it ever reaches disk. */
function safeAssetName(name) {
  const value = String(name || '');
  if (!/^[a-f0-9-]{8,64}\.(png|jpg|jpeg|webp|gif|avif)$/i.test(value)) throw new PresentationError('That picture was not found.', 404);
  if (value.includes('..')) throw new PresentationError('That picture was not found.', 404);
  return value;
}

function assetPath(userId, name) { return path.join(assetDir(userId), safeAssetName(name)); }

async function saveAsset(userId, buffer, mimeType = 'image/png', deps = {}) {
  const ext = IMAGE_EXT[String(mimeType).toLowerCase()] || 'png';
  const name = `${crypto.randomUUID()}.${ext}`;
  const write = deps.writeFile || fs.writeFile;
  const mkdir = deps.mkdir || fs.mkdir;
  await mkdir(assetDir(userId), { recursive: true });
  await write(path.join(assetDir(userId), name), buffer);
  return `/api/presentations/assets/${userId}/${name}`;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 32));
}

function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

async function parseDocument(buffer, mimeType, fileName, deps = {}) {
  const name = String(fileName || '').toLowerCase();
  const type = String(mimeType || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    const parse = deps.pdfParse || require('pdf-parse');
    const out = await parse(buffer);
    return text(out?.text || '', SOURCE_MAX);
  }
  if (name.endsWith('.docx') || type.includes('wordprocessingml')) {
    const mammoth = deps.mammoth || require('mammoth');
    const out = await mammoth.extractRawText({ buffer });
    return text(out?.value || '', SOURCE_MAX);
  }
  if (/\.(txt|md|markdown|csv|json)$/.test(name) || /^text\//.test(type)) {
    return text(buffer.toString('utf8'), SOURCE_MAX);
  }
  if (/html/i.test(type) || /\.(html?|htm)$/.test(name)) return htmlToText(buffer.toString('utf8')).slice(0, SOURCE_MAX);
  return '';
}

function isImage(file) {
  return IMAGE_MIMES.has(String(file?.mimetype || '').toLowerCase()) || /\.(png|jpe?g|webp|gif|avif)$/i.test(String(file?.originalname || ''));
}

function isPresentation(file) {
  const name = String(file?.originalname || '').toLowerCase();
  const type = String(file?.mimetype || '').toLowerCase();
  return /\.(pptx|potx)$/.test(name) || PRESENTATION_MIMES.has(type) || /presentationml\.(presentation|template)/.test(type);
}

function xmlAttr(tag, name) {
  return (String(tag).match(new RegExp(`\\b${name}="([^"]*)"`, 'i')) || [])[1] || '';
}

function slideNumber(part) { return Number((String(part).match(/slide(\d+)\.xml$/i) || [])[1] || 0); }

async function readPart(zip, name) {
  const entry = name && zip.files[String(name).replace(/^\//, '')];
  if (!entry) return '';
  // A 20 MB upload can still expand to a huge XML part. JSZip records the uncompressed size before we read it.
  if (Number.isFinite(entry._data?.uncompressedSize) && entry._data.uncompressedSize > 8 * 1024 * 1024) return '';
  return entry.async('string');
}

/** Relationship targets are relative to the part that owns them, not to its _rels folder. */
function resolvePart(fromPart, target) {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return ''; // external links are not package parts
  const clean = String(target).replace(/\\/g, '/').split(/[?#]/)[0];
  return clean.startsWith('/') ? clean.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(fromPart), clean));
}

/** Paragraphs from a DrawingML text body; <a:br/> becomes a line break, not a lost gap. */
function paragraphsFromXml(xml) {
  return [...String(xml || '').matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi)].map((m) => {
    const runs = [...m[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>/gi)]
      .map((run) => (run[1] === undefined ? '\n' : decodeEntities(run[1])));
    return text(runs.join(''), 700).replace(/\n{2,}/g, '\n');
  }).filter(Boolean);
}

/** Text shapes on a slide in document order: { ph, paragraphs }. */
function textShapes(xml) {
  return [...String(xml || '').matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/gi)].map((m) => {
    const shape = m[1];
    const nvPr = shape.match(/<p:nvPr\b[^>]*>([\s\S]*?)<\/p:nvPr>/i)?.[1] || '';
    const ph = xmlAttr(nvPr.match(/<p:ph\b[^>]*\/?>/i)?.[0] || '', 'type').toLowerCase();
    const body = shape.match(/<p:txBody\b[^>]*>([\s\S]*?)<\/p:txBody>/i)?.[1] || '';
    return { ph, paragraphs: paragraphsFromXml(body) };
  }).filter((shape) => shape.paragraphs.length);
}

function relationships(xml) {
  return [...String(xml || '').matchAll(/<Relationship\b([^>]*)>/gi)].map((m) => ({
    id: xmlAttr(m[1], 'Id'),
    type: xmlAttr(m[1], 'Type'),
    target: xmlAttr(m[1], 'Target'),
    external: /External/i.test(xmlAttr(m[1], 'TargetMode')),
  }));
}

function tableFromXml(xml) {
  const table = String(xml || '').match(/<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/i)?.[1];
  if (!table) return null;
  const rows = [...table.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/gi)].map((row) =>
    [...row[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/gi)]
      .map((cell) => text(paragraphsFromXml(cell[1]).join(' '), 160)).slice(0, 8)).filter((row) => row.length).slice(0, 12);
  return rows.length ? { rows, header: true } : null;
}

function notesFromXml(xml) {
  const shapes = textShapes(xml);
  const body = shapes.find((shape) => shape.ph === 'body');
  const lines = (body ? body.paragraphs : shapes.flatMap((shape) => shape.paragraphs))
    .filter((line) => !/^\d+$/.test(line.trim())); // slide-number fields are not speaker notes
  return text(lines.join('\n'), 1200);
}

/** One slide: canonical fields plus notes/table/images, all capped to what normalizeDeck keeps. */
async function parseSlide(zip, part, index, { userId, deps, warnings, fileName }) {
  const xml = await readPart(zip, part);
  const rels = relationships(await readPart(zip, `ppt/slides/_rels/slide${slideNumber(part)}.xml.rels`));
  const shapes = textShapes(xml);
  const titleShape = shapes.find((shape) => ['title', 'ctrTitle'].includes(shape.ph)) || shapes[0] || null;
  const title = text(titleShape?.paragraphs[0] || '', 120);
  const rest = shapes.filter((shape) => shape !== titleShape).flatMap((shape) => shape.paragraphs);
  const bullets = rest.filter((line) => line.length <= 220).slice(0, 6).map((line) => text(line, 220));
  const body = text([...rest.filter((line) => line.length > 220), ...rest.slice(6)].join('\n'), 700);
  const table = tableFromXml(xml);

  const noteRel = rels.find((rel) => /notesSlide/i.test(rel.target) || /\/notesSlide\b/i.test(rel.type));
  const notesPart = noteRel && !noteRel.external ? resolvePart(part, noteRel.target) : '';
  const notes = /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(notesPart) ? notesFromXml(await readPart(zip, notesPart)) : '';

  const embeds = new Set([...xml.matchAll(/\br:embed="([^"]+)"/gi)].map((m) => m[1]));
  const refs = [];
  const seen = new Set();
  for (const rel of rels) {
    if (rel.external || !embeds.has(rel.id) || !/\/image$/i.test(rel.type)) continue;
    const mediaPart = resolvePart(part, rel.target);
    if (!/^ppt\/media\/[^/]+$/i.test(mediaPart) || !zip.files[mediaPart] || seen.has(mediaPart)) continue;
    seen.add(mediaPart);
    const ext = String(mediaPart.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    const mime = IMAGE_MIME_FROM_EXT[ext];
    if (!mime) { warnings.push(`An image in ${fileName} (${ext || 'unknown'} format) could not be imported.`); continue; }
    if (zip.files[mediaPart]._data?.uncompressedSize > 10 * 1024 * 1024) {
      warnings.push(`An image in ${fileName} was too large to import.`);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const bytes = await zip.files[mediaPart].async('nodebuffer');
      // eslint-disable-next-line no-await-in-loop
      refs.push(await (deps.saveAsset || saveAsset)(userId, bytes, mime, deps));
    } catch { warnings.push(`An image in ${fileName} could not be saved.`); }
    if (refs.length >= 13) break;
  }

  return {
    id: `s${slideNumber(part) || index + 1}`,
    layout: index === 0 ? 'title' : (refs.length ? 'picture' : 'bullets'),
    title, bullets, body, notes,
    imageRef: refs[0] || '',
    images: refs.slice(1).map((ref, i) => ({ id: `img${i + 1}`, ref })),
    ...(table ? { table } : {}),
  };
}

/** Read the slides, notes, tables and pictures of one .pptx/.potx into raw deck slides. */
async function parsePresentation(buffer, fileName, userId, deps = {}, warnings = []) {
  let zip;
  try { zip = await (deps.JSZip || JSZip).loadAsync(buffer); } catch { throw new PresentationError('That PowerPoint file could not be opened.'); }
  const parts = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (!parts.length) throw new PresentationError('That PowerPoint file has no slides.');

  let coreTitle = '';
  try {
    const core = await readPart(zip, 'docProps/core.xml');
    coreTitle = text(decodeEntities(core.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] || ''), 160);
  } catch { /* document properties are optional */ }

  const slides = [];
  for (const part of parts.slice(0, MAX_SLIDES)) {
    // eslint-disable-next-line no-await-in-loop
    const slide = await parseSlide(zip, part, slides.length, { userId, deps, warnings, fileName });
    if (slide.title || slide.bullets.length || slide.body || slide.notes || slide.imageRef || slide.table) slides.push(slide);
  }
  if (parts.length > MAX_SLIDES) warnings.push(`Only the first ${MAX_SLIDES} slides of ${fileName} were imported.`);
  if (!slides.length) throw new PresentationError('That PowerPoint file has no readable slides.');
  return {
    title: coreTitle || path.basename(String(fileName || 'presentation')).replace(/\.(pptx|potx)$/i, ''),
    slides,
  };
}

/**
 * Build one sourceText bundle from uploaded files and/or one public URL.
 * Returns { sourceText, imageRefs, warnings, deck? } — a readable .pptx/.potx also gives us a canonical deck.
 * `deps` exists for direct node tests; no network is used unless a URL is supplied.
 */
async function extractSources({ files = [], url = '', userId }, deps = {}) {
  if (!userId) throw new PresentationError('Sign in to import a source.', 401);
  const list = Array.isArray(files) ? files.slice(0, MAX_FILES) : [];
  const warnings = [];
  if (Array.isArray(files) && files.length > MAX_FILES) warnings.push(`Only the first ${MAX_FILES} files were used.`);
  const chunks = [];
  const imageRefs = [];
  let deck = null;

  for (const file of list) {
    const buffer = file?.buffer;
    if (!Buffer.isBuffer(buffer) || !buffer.length) { warnings.push(`${file?.originalname || 'A file'} was empty and was skipped.`); continue; }
    if (buffer.length > MAX_FILE_BYTES) { warnings.push(`${file.originalname || 'A file'} is too large (max 20MB) and was skipped.`); continue; }
    // eslint-disable-next-line no-await-in-loop
    if (isImage(file)) imageRefs.push(await saveAsset(userId, buffer, file.mimetype, deps));
    else if (isPresentation(file)) {
      if (deck) { warnings.push(`${file.originalname || 'Another presentation'} was skipped; only the first presentation was imported.`); continue; }
      try {
        // eslint-disable-next-line no-await-in-loop
        const parsed = await parsePresentation(buffer, file.originalname, userId, deps, warnings);
        deck = normalizeDeck({ title: parsed.title, subtitle: '', themeId: 'paper', aspect: '16:9', slides: parsed.slides });
        chunks.push(parsed.slides.map((slide) => [slide.title, slide.bullets.join('\n'), slide.body, slide.notes].filter(Boolean).join('\n')).join('\n\n'));
      } catch (err) {
        warnings.push(`${file.originalname || 'That presentation'} could not be read as a presentation: ${err.message}`);
      }
    } else {
      // eslint-disable-next-line no-await-in-loop
      const parsed = await parseDocument(buffer, file.mimetype, file.originalname, deps).catch(() => '');
      if (parsed) chunks.push(parsed);
      else warnings.push(`${file.originalname || 'That file'} could not be read as text.`);
    }
  }

  if (String(url || '').trim()) {
    const fetch = deps.fetchPublicFile || fetchPublicFile;
    let result;
    try {
      result = await fetch(String(url).trim(), { maxBytes: MAX_FILE_BYTES, accept: 'text/html,application/pdf,text/plain,image/*' });
    } catch (err) {
      throw new PresentationError(err.status === 400 ? err.message : 'That web address could not be read.', err.status || 400);
    }
    if (isImage({ mimetype: result.contentType })) imageRefs.push(await saveAsset(userId, result.buffer, result.contentType, deps));
    else {
      const parsed = await parseDocument(result.buffer, result.contentType, result.finalUrl, deps).catch(() => '');
      if (parsed) chunks.push(parsed);
      else warnings.push('That web page had no readable text.');
    }
  }

  const sourceText = text(chunks.join('\n\n'), SOURCE_MAX);
  if (!sourceText && !imageRefs.length) throw new PresentationError('No usable text or pictures were found in that source.', 400);
  const result = { sourceText, imageRefs: imageRefs.slice(0, 8), warnings };
  if (deck) result.deck = deck;
  return result;
}

module.exports = {
  UPLOAD_DIR, ASSET_ROOT, MAX_FILES, MAX_FILE_BYTES, IMAGE_MIMES,
  assetDir, assetPath, safeAssetName, saveAsset, htmlToText, parseDocument, extractSources,
};
