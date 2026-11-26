'use strict';

// Turns a page's HTML into the stored snapshot (docs/html-content-check.md, "Snapshot"). Pure apart from the bundled reader:
//   { v: 1, meta: { title, finalUrl, fetchedVia, chars, words, pageUrl, author, published, modified, generator },
//     blocks: [{ id, type, level?, style?, number?, text, runs?, src?, table?, section: [heading path] }] }
// Block types are DocCompare's: heading, paragraph (style 'Quote' or 'Code'), listItem, tableCell, image (text = alt). `runs` is kept
// only when some run carries formatting or a link. The original text is stored; normalizeText() is applied only when comparing.

const lib = require('./lib');
const { MAX_SNAPSHOT_CHARS } = require('./config');

const pub = (message, code) => Object.assign(new Error(message), { isPublic: true, status: 422, code });

/** Text as compared (never as shown): invisible characters and space variants, curly quotes and runs of whitespace are evened out.
 *  Case and dashes are left alone, so a changed capital or an en dash for a hyphen is still a change. */
function normalizeText(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[­​-‍⁠﻿]/g, '') // soft hyphen, zero-width characters
    .replace(/[  -   　]/g, ' ') // non-breaking and other spaces
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const plainRuns = (runs) => !runs || runs.every((r) => Object.keys(r).every((k) => k === 'text'));

/** Returns { snapshot, thin }. Throws a public error (code TOO_BIG) over the size cap; `thin` = almost no text (the caller decides). */
function buildSnapshot(html, { finalUrl = null, fetchedVia }) {
  const x = lib.extractFull(html, finalUrl || undefined);
  const path = []; // heading texts by level
  let chars = 0;
  let words = 0;
  const blocks = x.blocks.map((b, i) => {
    if (b.type === 'heading') { path.length = Math.max(0, (b.level || 1) - 1); path[(b.level || 1) - 1] = b.text.trim(); }
    if (b.type !== 'image') { chars += b.text.length; words += lib.countWords(b.text); }
    const out = { id: `b${i + 1}`, type: b.type, text: b.text, section: path.filter(Boolean) };
    for (const k of ['level', 'style', 'number', 'src']) if (b[k] != null) out[k] = b[k];
    if (b.location?.table) out.table = b.location.table;
    if (!plainRuns(b.runs)) out.runs = b.runs;
    return out;
  });
  if (chars > MAX_SNAPSHOT_CHARS) {
    throw pub(`This page has ${chars.toLocaleString('en-AU')} characters of text, more than the ${MAX_SNAPSHOT_CHARS.toLocaleString('en-AU')} HTML Content Check can keep for one check. Nothing was cut; the check was stopped instead.`, 'TOO_BIG');
  }
  const iso = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null);
  return {
    thin: words < lib.thinWords(),
    snapshot: {
      v: 1,
      meta: { title: x.title || null, finalUrl, fetchedVia, chars, words, pageUrl: x.url || null, author: x.author || null, published: iso(x.published), modified: iso(x.modified), generator: x.generator || null },
      blocks,
    },
  };
}

module.exports = { buildSnapshot, normalizeText };
