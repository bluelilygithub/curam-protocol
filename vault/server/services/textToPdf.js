'use strict';

// Renders pasted formatted text (markdown-lite) to a PDF using @react-pdf/renderer.
// Supports: # / ## / ### headings, **bold** inline spans, - / * / • bullet lines,
// blank-line-separated paragraphs. Mirrors the block parsing style used by
// webExtractorPdf.js for consistency.

const React = require('react');

const DARK = '#1A1A1A';
const MUTED = '#6B7280';

function buildDocument(deps, { title, text }) {
  const { Document, Page, Text, View, StyleSheet } = deps;

  const styles = StyleSheet.create({
    page: { fontSize: 10.5, fontFamily: 'Helvetica', color: DARK, paddingHorizontal: 48, paddingTop: 48, paddingBottom: 44, lineHeight: 1.5 },
    title: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 16 },
    divider: { borderBottomWidth: 1, borderBottomColor: '#E5E7EB', marginBottom: 16 },
    paragraph: { fontSize: 10.5, color: DARK, marginBottom: 10 },
    heading1: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: DARK, marginTop: 6, marginBottom: 8 },
    heading2: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: DARK, marginTop: 5, marginBottom: 7 },
    heading3: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', color: DARK, marginTop: 4, marginBottom: 6 },
    bulletRow: { flexDirection: 'row', marginBottom: 4 },
    bulletMark: { width: 12, fontSize: 10.5, color: MUTED },
    bulletText: { flex: 1, fontSize: 10.5, color: DARK },
  });

  // Split **bold** spans out of a line of text into an array of Text runs.
  function renderInline(line) {
    const parts = String(line).split(/(\*\*.+?\*\*)/g).filter(Boolean);
    return parts.map((part, i) => {
      const m = part.match(/^\*\*(.+)\*\*$/);
      return m
        ? React.createElement(Text, { key: String(i), style: { fontFamily: 'Helvetica-Bold' } }, m[1])
        : React.createElement(Text, { key: String(i) }, part);
    });
  }

  const rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');

  // Group into blocks: headings / bullet runs / paragraphs (blank-line separated).
  const blocks = [];
  let para = [];
  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'paragraph', lines: para }); para = []; }
  };
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) { flushPara(); continue; }
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushPara();
      blocks.push({ type: `heading${heading[1].length}`, text: heading[2] });
      continue;
    }
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushPara();
      blocks.push({ type: 'bullet', text: bullet[1] });
      continue;
    }
    para.push(trimmed);
  }
  flushPara();

  return React.createElement(Document, null,
    React.createElement(Page, { size: 'A4', style: styles.page },
      title && React.createElement(Text, { style: styles.title }, title),
      title && React.createElement(View, { style: styles.divider }),
      ...blocks.map((b, i) => {
        if (b.type === 'bullet') {
          return React.createElement(View, { key: String(i), style: styles.bulletRow },
            React.createElement(Text, { style: styles.bulletMark }, '•'),
            React.createElement(Text, { style: styles.bulletText }, renderInline(b.text)),
          );
        }
        if (b.type.startsWith('heading')) {
          return React.createElement(Text, { key: String(i), style: styles[b.type] }, renderInline(b.text));
        }
        return React.createElement(Text, { key: String(i), style: styles.paragraph }, renderInline(b.lines.join(' ')));
      }),
    ),
  );
}

async function generateTextPdf({ title, text }) {
  const deps = await import('@react-pdf/renderer');
  const element = buildDocument(deps, { title, text });
  return deps.renderToBuffer(element);
}

module.exports = { generateTextPdf };
