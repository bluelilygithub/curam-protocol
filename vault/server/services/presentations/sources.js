'use strict';

// Turn uploaded documents, a public web page or pictures into source material for a deck. Nothing here talks to a model.
// Pictures are written under {UPLOAD_DIR}/presentations/<userId>/ and are referred to by a small, owned API path.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { fetchPublicFile } = require('../../utils/safeFetch');
const { SOURCE_MAX } = require('./schema');
const { PresentationError, text } = require('./schema');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads');
const ASSET_ROOT = path.join(UPLOAD_DIR, 'presentations');
const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const IMAGE_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
};

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
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 32));
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

/**
 * Build one sourceText bundle from uploaded files and/or one public URL.
 * Returns { sourceText, imageRefs, warnings }. `deps` exists for direct node tests; no network is used unless a URL is supplied.
 */
async function extractSources({ files = [], url = '', userId }, deps = {}) {
  if (!userId) throw new PresentationError('Sign in to import a source.', 401);
  const list = Array.isArray(files) ? files.slice(0, MAX_FILES) : [];
  const warnings = [];
  if (Array.isArray(files) && files.length > MAX_FILES) warnings.push(`Only the first ${MAX_FILES} files were used.`);
  const chunks = [];
  const imageRefs = [];

  for (const file of list) {
    const buffer = file?.buffer;
    if (!Buffer.isBuffer(buffer) || !buffer.length) { warnings.push(`${file?.originalname || 'A file'} was empty and was skipped.`); continue; }
    if (buffer.length > MAX_FILE_BYTES) { warnings.push(`${file.originalname || 'A file'} is too large (max 20MB) and was skipped.`); continue; }
    // eslint-disable-next-line no-await-in-loop
    if (isImage(file)) imageRefs.push(await saveAsset(userId, buffer, file.mimetype, deps));
    else {
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
  return { sourceText, imageRefs: imageRefs.slice(0, 8), warnings };
}

module.exports = {
  UPLOAD_DIR, ASSET_ROOT, MAX_FILES, MAX_FILE_BYTES, IMAGE_MIMES,
  assetDir, assetPath, safeAssetName, saveAsset, htmlToText, parseDocument, extractSources,
};
