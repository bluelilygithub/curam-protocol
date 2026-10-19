'use strict';

const React = require('react');

const DARK = '#1A1A1A';
const MUTED = '#6B7280';
const PRIMARY = '#CC785C';

function buildDocument(deps, { title, byline, url, text }) {
  const { Document, Page, Text, View, StyleSheet, Link } = deps;

  const styles = StyleSheet.create({
    page: { fontSize: 10.5, fontFamily: 'Helvetica', color: DARK, paddingHorizontal: 48, paddingTop: 48, paddingBottom: 44, lineHeight: 1.5 },
    title: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 6 },
    byline: { fontSize: 9.5, color: MUTED, marginBottom: 4 },
    url: { fontSize: 8.5, color: PRIMARY, marginBottom: 16 },
    divider: { borderBottomWidth: 1, borderBottomColor: '#E5E7EB', marginBottom: 16 },
    paragraph: { fontSize: 10.5, color: DARK, marginBottom: 10 },
    heading1: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: DARK, marginTop: 6, marginBottom: 8 },
    heading2: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: DARK, marginTop: 5, marginBottom: 7 },
    heading3: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', color: DARK, marginTop: 4, marginBottom: 6 },
  });

  // Article text carries markdown-style `#`/`##`/`###` prefixes on heading
  // lines (see webExtractorService.blockToText) — render those bold/larger.
  const blocks = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^(#{1,6})\s+(.*)$/);
      if (!m) return { type: 'paragraph', text: p };
      const level = Math.min(m[1].length, 3);
      return { type: `heading${level}`, text: m[2] };
    });

  return React.createElement(Document, null,
    React.createElement(Page, { size: 'A4', style: styles.page },
      React.createElement(Text, { style: styles.title }, title || 'Untitled article'),
      byline && React.createElement(Text, { style: styles.byline }, byline),
      url && React.createElement(Link, { src: url, style: styles.url }, url),
      React.createElement(View, { style: styles.divider }),
      ...blocks.map((b, i) => React.createElement(Text, { key: String(i), style: styles[b.type] || styles.paragraph }, b.text)),
    ),
  );
}

// The PDF uses the built-in Helvetica, which only has the Western (WinAnsi) letters. Anything else (Chinese, emoji, ...) would come
// out as blanks or garbage, so it is replaced with "?" and the caller is told how many were replaced.
const WIN_ANSI_EXTRA = new Set('‘’‚“”„–—•…€™†‡‰ŒœŠšŸŽžƒˆ˜‹›');

function winAnsiSafe(input) {
  let replaced = 0;
  let out = '';
  for (const ch of String(input || '')) {
    const code = ch.codePointAt(0);
    if (ch === '\n' || ch === '\t' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (code < 0x20 || code === 0x7f || (code >= 0x200b && code <= 0x200f) || code === 0xfeff) continue; // control / zero-width: drop quietly
    else { out += '?'; replaced += 1; }
  }
  return { text: out, replaced };
}

async function generateArticlePdf(article) {
  const deps = await import('@react-pdf/renderer');
  const element = buildDocument(deps, article);
  return deps.renderToBuffer(element);
}

module.exports = { generateArticlePdf, winAnsiSafe };
