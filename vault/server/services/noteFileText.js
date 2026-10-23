'use strict';

// Reading inside the files attached to notes, so "Ask your notes" can find and quote what a PDF, document or spreadsheet says.
//
// A file's text is pulled out once, kept in attachment_text (with a search index), and used by noteAsk.js two ways: the word search also
// looks in it, and when a note is read for an answer, the part of each file that matches the question is read with it. Nothing here
// changes a file or a note. A file with no text in it (a photo, a scanned PDF, an old .doc) is recorded as "none" so it is not tried again.
//
// Extraction happens in the background a moment after a file is attached; a file attached before this existed is read the first time
// Ask looks at its note (a few at a time, the rest in the background). Text is the person's own, kept under their id, and deleted with
// the file (the table cascades from attachments). Pure helpers are unit-tested: node server/services/noteFileText.test.js

const fs = require('fs');

const MAX_READ_BYTES = 25 * 1024 * 1024; // a bigger file is not opened (it is still attached, just not read)
const MAX_TEXT_CHARS = 150000;           // kept per file
const PER_ASK = 6;                       // files read while the person waits
const BACKFILL_MAX = 100;                // files one background run will read
const READ_TIMEOUT_MS = 20000;
const WINDOW = 700;                      // size of a passage when picking the parts of a file that match a question

const DIRECT = new Set(['.txt', '.md', '.json', '.csv']);
const READABLE = new Set([...DIRECT, '.pdf', '.docx', '.xlsx', '.xls', '.pptx']);
const control = { enabled: true }; // tests switch background work off

const extOf = (name) => { const m = /\.[^.\\/]+$/.exec(String(name || '').toLowerCase()); return m ? m[0] : ''; };

/** Whether a file of this name can have its text read at all (photos, scans and old .doc / .ppt files cannot). */
const canRead = (filename) => READABLE.has(extOf(filename));

/** Tidy extracted text: one line ending, no runs of blanks, no control characters, bounded. */
function cleanText(text) {
  return String(text ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t\f\v]{2,}/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function pptxText(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const parts = [];
  for (const [i, name] of slides.entries()) {
    const xml = await zip.files[name].async('string');
    const runs = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]));
    if (runs.length) parts.push(`Slide ${i + 1}: ${runs.join(' ')}`);
  }
  return parts.join('\n');
}

function xlsxText(filePath) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const parts = [];
  for (const name of workbook.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { skipHidden: true });
    if (csv.replace(/[,\s]/g, '')) parts.push(`Sheet ${name}:\n${csv}`);
  }
  return parts.join('\n\n');
}

/**
 * The text inside the file at `filePath`, as { status: 'ok' | 'none', text }. 'none' means there is nothing to read (an unsupported kind,
 * a picture or scan, a file too large or damaged). Never throws.
 */
async function readFileText(filePath, filename) {
  const ext = extOf(filename || filePath);
  if (!READABLE.has(ext)) return { status: 'none', text: '' };
  try {
    const size = fs.statSync(filePath).size;
    if (size === 0 || size > MAX_READ_BYTES) return { status: 'none', text: '' };
    let text = '';
    if (DIRECT.has(ext)) {
      const buf = fs.readFileSync(filePath);
      if (buf.subarray(0, 4000).includes(0)) return { status: 'none', text: '' }; // not really text
      text = buf.toString('utf8');
    } else if (ext === '.pdf') {
      const pages = await require('../utils/pdfText').extractPdfTextFromBuffer(fs.readFileSync(filePath));
      text = pages.map((p) => String(p).replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n');
    } else if (ext === '.docx') {
      text = (await require('mammoth').extractRawText({ path: filePath })).value;
    } else if (ext === '.xlsx' || ext === '.xls') {
      text = xlsxText(filePath);
    } else if (ext === '.pptx') {
      text = await pptxText(fs.readFileSync(filePath));
    }
    text = cleanText(text);
    return text.length >= 3 ? { status: 'ok', text } : { status: 'none', text: '' };
  } catch {
    return { status: 'none', text: '' };
  }
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => { const t = setTimeout(() => resolve(null), ms); if (t.unref) t.unref(); })]);

// ---- picking the parts of a file that matter to a question -------------------------------------------------------------------------

/** Cut text into passages of about `size` characters, at line ends or sentence ends where there are any. */
function passages(text, size = WINDOW) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > size) {
    let cut = Math.max(rest.lastIndexOf('\n', size), rest.lastIndexOf('. ', size) + 1);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/**
 * At most `max` characters of `text`: the passages that contain the most of the `keywords` (a keyword matches the start of a word, as in
 * the search), kept in the order they appear and joined with " … ". With no keyword hit, the start of the text. Short text comes back whole.
 */
function fileExcerpt(text, keywords, max) {
  const full = String(text || '').trim();
  if (full.length <= max) return full;
  const words = (Array.isArray(keywords) ? keywords : []).flatMap((k) => String(k).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 2);
  const parts = passages(full);
  const scored = parts.map((p, i) => {
    const low = p.toLowerCase();
    return { i, p, score: new Set(words.filter((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(low))).size };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
  if (!hits.length) return `${full.slice(0, max - 1).trimEnd()}…`;
  const chosen = [];
  let used = 0;
  for (const h of hits) {
    const room = max - used - (chosen.length ? 3 : 0);
    if (room < 80) break;
    const piece = h.p.length > room ? `${h.p.slice(0, room - 1).trimEnd()}…` : h.p;
    chosen.push({ i: h.i, piece });
    used += piece.length + (chosen.length > 1 ? 3 : 0);
  }
  return chosen.sort((a, b) => a.i - b.i).map((c) => c.piece).join(' … ');
}

/**
 * What to show the model from a note's files: { text, read, unread, pending } (text, and the file names under each heading). `files` are { filename, status, text }; the budget
 * `max` is shared between the files that have text (at least 300 each while it lasts). Files with no readable text are only named.
 */
function filesForPrompt(files, keywords, max) {
  const list = Array.isArray(files) ? files : [];
  const withText = list.filter((f) => f.status === 'ok' && f.text);
  const pending = list.filter((f) => f.status === 'pending').map((f) => f.filename);
  const unread = list.filter((f) => f.status !== 'pending' && !(f.status === 'ok' && f.text)).map((f) => f.filename);
  const blocks = [];
  const read = [];
  let left = max;
  for (const [i, f] of withText.entries()) {
    const share = Math.max(300, Math.floor(left / (withText.length - i)));
    if (left < 200) break;
    const excerpt = fileExcerpt(f.text, keywords, Math.min(share, left));
    left -= excerpt.length;
    read.push(f.filename);
    blocks.push(`FILE "${f.filename}" (text read from this attached file${excerpt.length < f.text.length ? ', the parts that matter to the question' : ''}):\n${excerpt}`);
  }
  if (unread.length) blocks.push(`Also attached, but not read (no text could be taken from ${unread.length === 1 ? 'it' : 'them'}): ${unread.join(', ')}`);
  if (pending.length) blocks.push(`Also attached, but not read yet (still being prepared): ${pending.join(', ')}`);
  return { text: blocks.join('\n\n'), read, unread, pending };
}

// ---- database ---------------------------------------------------------------------------------------------------------------------

/** Read one attached file ({ id, userId, filename, storedPath }) and keep its text. Never throws. Returns the status, or null if it could not be kept. */
async function extractAttachment(pool, att) {
  try {
    const result = await withTimeout(readFileText(att.storedPath, att.filename), READ_TIMEOUT_MS) || { status: 'none', text: '' };
    const keep = (text) => pool.query(
      `INSERT INTO attachment_text (attachment_id, user_id, status, text, tsv, chars, updated_at)
       VALUES ($1,$2,$3,$4, to_tsvector('english', $4), $5, NOW())
       ON CONFLICT (attachment_id) DO UPDATE SET status=EXCLUDED.status, text=EXCLUDED.text, tsv=EXCLUDED.tsv, chars=EXCLUDED.chars, updated_at=NOW()`,
      [att.id, att.userId, result.status, text, text.length]);
    try { await keep(result.text); } catch (err) {
      if (err.code === '23503') return null; // the file was removed while it was being read
      await keep(result.text.slice(0, 40000)); // a search index has a size limit; keep the start
    }
    return result.status;
  } catch { return null; }
}

/** Read this file a moment after it is attached. Never throws, never blocks the upload. */
function queueExtract(att, deps = {}) {
  if (!control.enabled) return;
  const t = setTimeout(() => { extractAttachment(deps.pool || require('../db').pool, att); }, 200);
  if (t.unref) t.unref();
}

/**
 * Read up to `limit` of the files on the notes in `filters` ({ where, params } from noteQuery.buildFilters) that have not been read yet,
 * newest first. Returns { missing, done }: how many were unread, how many of those were read now.
 */
async function indexMissing(pool, filters, limit = PER_ASK) {
  const sql = `SELECT a.id, a."userId", a.filename, a."storedPath"
      FROM notes n LEFT JOIN projects p ON p.id = n.project_id AND p."userId" = n.user_id LEFT JOIN clients c ON c.id = n.client_id AND c."userId" = n.user_id
      JOIN attachments a ON a."entityType"='note' AND a."entityId" = n.id AND a."userId" = n.user_id
      LEFT JOIN attachment_text t ON t.attachment_id = a.id
     WHERE ${filters.where.join(' AND ')} AND t.attachment_id IS NULL
     ORDER BY a.id DESC`;
  const rows = (await pool.query(sql, filters.params)).rows;
  let done = 0;
  for (const att of rows.slice(0, Math.max(0, limit))) if ((await extractAttachment(pool, att)) !== null) done += 1;
  return { missing: rows.length, done };
}

const running = new Set();
/** Read the rest of a person's unread files after a question, one run per person at a time. Never throws, never blocks. */
function backfill(userId, deps = {}) {
  if (!control.enabled || running.has(userId)) return;
  running.add(userId);
  (async () => {
    try {
      const pool = deps.pool || require('../db').pool;
      await indexMissing(pool, { where: ['n.user_id=$1'], params: [userId] }, BACKFILL_MAX);
    } catch { /* best effort */ } finally { running.delete(userId); }
  })();
}

/** The files on these notes with their text: Map of note id -> [{ id, filename, status, text }] (status 'pending' = not read yet). */
async function loadForNotes(pool, userId, noteIds) {
  const out = new Map();
  if (!noteIds.length) return out;
  const rows = (await pool.query(
    `SELECT a."entityId" AS note_id, a.id, a.filename, COALESCE(t.status, 'pending') AS status, COALESCE(t.text, '') AS text
       FROM attachments a LEFT JOIN attachment_text t ON t.attachment_id = a.id
      WHERE a."userId"=$1 AND a."entityType"='note' AND a."entityId" = ANY($2::int[]) ORDER BY a.id`, [userId, noteIds])).rows;
  for (const r of rows) {
    if (!out.has(r.note_id)) out.set(r.note_id, []);
    out.get(r.note_id).push({ id: r.id, filename: r.filename, status: r.status, text: r.text });
  }
  return out;
}

module.exports = {
  MAX_TEXT_CHARS, PER_ASK, READABLE, control,
  canRead, cleanText, readFileText, passages, fileExcerpt, filesForPrompt,
  extractAttachment, queueExtract, indexMissing, backfill, loadForNotes,
};
