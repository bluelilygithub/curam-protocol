'use strict';

/**
 * AI Visibility PDF. Renders the Markdown report with pdf-lib, so the PDF and the
 * copied Markdown always say the same thing. Standard fonts only; characters outside
 * WinAnsi are transliterated by clean().
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const C = {
  primary: rgb(0.8, 0.47, 0.36),
  text: rgb(0.1, 0.1, 0.1),
  muted: rgb(0.42, 0.45, 0.5),
  border: rgb(0.85, 0.85, 0.82),
  bgAlt: rgb(0.96, 0.96, 0.94),
};

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 46;
const CONTENT_W = PAGE_W - MARGIN * 2;

function clean(value) {
  return String(value == null ? '' : value)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/→/g, '->')
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/±/g, '+/-')
    .replace(/°C/g, ' degC')
    .replace(/°F/g, ' degF')
    .replace(/°/g, ' deg')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function stripInline(value) {
  return clean(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

function wordWrap(text, font, size, maxWidth) {
  const safe = stripInline(text);
  const lines = [];
  for (const para of safe.split(/\n+/)) {
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (!word) continue;
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function makeBuilder(pdfDoc, fonts) {
  const { reg, bold } = fonts;
  let page;
  let y;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function ensureSpace(h) {
    if (y - h < MARGIN + 16) newPage();
  }

  function text(str, { size = 10, font = reg, color = C.text, gap = 3, maxWidth = CONTENT_W, x = MARGIN } = {}) {
    const lines = wordWrap(str, font, size, maxWidth);
    for (const line of lines) {
      ensureSpace(size + 3);
      page.drawText(line, { x, y: y - size, size, font, color });
      y -= size + 3;
    }
    y -= gap;
  }

  function bullet(str, { size = 10, color = C.text } = {}) {
    const lines = wordWrap(str, reg, size, CONTENT_W - 14);
    lines.forEach((line, i) => {
      ensureSpace(size + 3);
      if (i === 0) page.drawText('•', { x: MARGIN, y: y - size, size, font: reg, color: C.primary });
      page.drawText(line, { x: MARGIN + 14, y: y - size, size, font: reg, color });
      y -= size + 3;
    });
    y -= 2;
  }

  function heading(str, { size = 13, color = C.text, gap = 6, rule = false } = {}) {
    ensureSpace(size + 14);
    text(str, { size, font: bold, color, gap });
    if (rule) {
      page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: PAGE_W - MARGIN, y: y + 2 }, thickness: 0.75, color: C.border });
      y -= 6;
    }
  }

  function hline() {
    ensureSpace(10);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: C.border });
    y -= 10;
  }

  function callout(str) {
    const lines = wordWrap(str, reg, 9, CONTENT_W - 16);
    const h = lines.length * 12 + 12;
    ensureSpace(h + 8);
    page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, color: C.bgAlt, borderColor: C.border, borderWidth: 0.75 });
    let cy = y - 9;
    for (const line of lines) {
      page.drawText(line, { x: MARGIN + 8, y: cy - 3, size: 9, font: reg, color: C.muted });
      cy -= 12;
    }
    y -= h + 8;
  }

  newPage();
  return { text, bullet, heading, hline, callout, get page() { return page; }, get y() { return y; } };
}

function renderMarkdown(b, markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  let inTable = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      b.text('', { gap: 1 });
      inTable = false;
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      b.hline();
      continue;
    }

    // Table: render each row as one line with the cells separated by a middle dot.
    if (/^\|.*\|$/.test(trimmed)) {
      if (/^\|[\s:-]+\|/.test(trimmed)) continue;
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean);
      if (!cells.length) continue;
      const isHeader = !inTable;
      inTable = true;
      b.text(cells.join('  ·  '), { size: isHeader ? 9.5 : 9, font: isHeader ? undefined : undefined, color: isHeader ? C.text : C.text, gap: 1 });
      continue;
    }
    inTable = false;

    if (trimmed.startsWith('> ')) {
      b.callout(trimmed.slice(2));
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = level === 1 ? 18 : level === 2 ? 14 : level === 3 ? 11.5 : 10.5;
      b.heading(heading[2], { size, rule: level === 1, gap: level === 1 ? 10 : 6 });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      b.bullet(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      b.bullet(`${numbered[1]}. ${numbered[2]}`);
      continue;
    }

    b.text(trimmed, { size: 10, gap: 3 });
  }
}

function drawFooters(pdfDoc, fonts) {
  const pages = pdfDoc.getPages();
  pages.forEach((page, i) => {
    page.drawText(`AI Visibility · ${i + 1} / ${pages.length}`, {
      x: MARGIN,
      y: 24,
      size: 8,
      font: fonts.reg,
      color: C.muted,
    });
    page.drawText('Curam Vault', {
      x: PAGE_W - MARGIN - fonts.reg.widthOfTextAtSize('Curam Vault', 8),
      y: 24,
      size: 8,
      font: fonts.reg,
      color: C.muted,
    });
  });
}

async function buildAiVisibilityPdfBuffer(markdown) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('AI Visibility Report');
  pdfDoc.setAuthor('Curam Vault');
  pdfDoc.setCreator('Curam Vault');

  const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { reg, bold };
  const b = makeBuilder(pdfDoc, fonts);

  renderMarkdown(b, markdown);
  drawFooters(pdfDoc, fonts);
  return pdfDoc.save();
}

module.exports = { buildAiVisibilityPdfBuffer, clean, stripInline };
