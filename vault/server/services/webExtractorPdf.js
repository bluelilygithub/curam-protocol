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
  });

  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return React.createElement(Document, null,
    React.createElement(Page, { size: 'A4', style: styles.page },
      React.createElement(Text, { style: styles.title }, title || 'Untitled article'),
      byline && React.createElement(Text, { style: styles.byline }, byline),
      url && React.createElement(Link, { src: url, style: styles.url }, url),
      React.createElement(View, { style: styles.divider }),
      ...paragraphs.map((p, i) => React.createElement(Text, { key: String(i), style: styles.paragraph }, p)),
    ),
  );
}

async function generateArticlePdf(article) {
  const deps = await import('@react-pdf/renderer');
  const element = buildDocument(deps, article);
  return deps.renderToBuffer(element);
}

module.exports = { generateArticlePdf };
