'use strict';

// Turn an email's HTML into readable plain text. Pure: no network, no database.
//
// The old way (delete every <tag>) left the contents of <style> blocks in the text, ran everything onto one line and showed &nbsp; as
// characters. This drops styles, scripts, comments and the head; keeps paragraphs, line breaks, lists, quoted replies, table rows and
// link addresses; and decodes entities. Bold and italic cannot show in plain text, so they are not marked.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™',
  bull: '•', middot: '·', euro: '€', pound: '£', cent: '¢', deg: '°', times: '×',
  laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä',
};

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10FFFF) return '';
      try { return String.fromCodePoint(n); } catch { return ''; }
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// zero-width and soft-hyphen padding that marketing mail uses to fill the preview line
const INVISIBLE = /[​-‏⁠͏­﻿]/g;

function tidy(s) {
  return s
    .replace(/\r/g, '')
    .replace(INVISIBLE, '')
    .replace(/ /g, ' ')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function plainFromTags(html) {
  let s = html;
  // links: keep the address when the visible text does not already show it (and it is short enough to read)
  s = s.replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (m, q, href, inner) => {
    const label = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const url = decodeEntities(href).trim();
    if (!label) return '';
    if (!/^(https?:|mailto:)/i.test(url) || url.length > 120) return label;
    const bare = url.replace(/^(https?:\/\/|mailto:)/i, '').replace(/\/$/, '');
    if (label.includes(bare) || label.includes(url)) return label;
    return `${label} (${url.replace(/^mailto:/i, '')})`;
  });
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(p|h[1-6]|table|ul|ol|pre)\s*>/gi, '\n\n');
  s = s.replace(/<(hr)\b[^>]*>/gi, '\n');
  s = s.replace(/<\/(div|tr|section|article|header|footer)\s*>/gi, '\n');
  s = s.replace(/<\/(td|th)\s*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  return s;
}

/** Quoted replies (<blockquote>) become lines starting "> ", which is how the rest of the tool already treats quoted text. */
function withQuotes(html) {
  const innermost = /<blockquote\b[^>]*>((?:(?!<blockquote\b)[\s\S])*?)<\/blockquote\s*>/i;
  let s = html;
  for (let i = 0; i < 20 && innermost.test(s); i += 1) {
    s = s.replace(innermost, (m, inner) => {
      const text = tidy(decodeEntities(plainFromTags(inner)));
      return `\n${text.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}\n`;
    });
  }
  return s;
}

function htmlToText(html) {
  let s = String(html == null ? '' : html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');                            // comments, including Outlook conditionals
  s = s.replace(/<head\b[\s\S]*?<\/head\s*>/gi, '');
  s = s.replace(/<(style|script|title|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<(style|script)\b[\s\S]*$/gi, '');                  // an unclosed block: drop to the end rather than show it
  s = withQuotes(s);
  s = plainFromTags(s);
  return tidy(decodeEntities(s));
}

/**
 * The readable body of a Gmail message payload: the plain-text part when there is one, otherwise the HTML turned into text.
 * Same walk as routes/gmail.js extractBody, with the HTML handled properly.
 */
function extractBodyReadable(payload) {
  if (!payload) return '';
  const data = (p) => Buffer.from(p.body.data, 'base64').toString('utf8');
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) return tidy(data(payload));
  if (payload.mimeType === 'text/html' && payload.body && payload.body.data) return htmlToText(data(payload));
  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain' && p.body && p.body.data);
    if (textPart) return extractBodyReadable(textPart);
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html' && p.body && p.body.data);
    if (htmlPart) return extractBodyReadable(htmlPart);
    for (const part of payload.parts) {
      const r = extractBodyReadable(part);
      if (r) return r;
    }
  }
  return '';
}

// ---- messages stored before this existed ----
// They were flattened to one line with the style rules still in them: ".x { margin: 0; } p { color: #333 } Hello ...". The text and its
// positions are kept exactly as stored (ledger quotes point into it), so this is only ever applied to what is SHOWN.
const CSS_RULE = /(?:@[a-z-]+[^{}]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}|[^{}\n]{0,300}\{[^{}]*:[^{}]*\})/gi;
const LOOKS_LIKE_CSS = /\{[^{}]*\b[a-z-]{3,}\s*:\s*[^{}]*\}/i;

function cleanStoredForDisplay(text) {
  const t = String(text == null ? '' : text);
  if (!LOOKS_LIKE_CSS.test(t) && !/&(?:nbsp|amp|#\d+);|<\/?[a-z][^>]*>/i.test(t)) return t;
  let s = t;
  if (/<\/?[a-z][^>]*>/i.test(s)) s = htmlToText(s);
  if (LOOKS_LIKE_CSS.test(s)) s = s.replace(CSS_RULE, ' ');
  return tidy(decodeEntities(s));
}

module.exports = { htmlToText, extractBodyReadable, cleanStoredForDisplay, decodeEntities };
