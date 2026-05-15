'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

async function buildStudyDeckPdfBuffer({ title, payload }) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const flashcards = Array.isArray(p.flashcards) ? p.flashcards : [];
  const slides = Array.isArray(p.slides) ? p.slides : [];
  const quiz = Array.isArray(p.quiz) ? p.quiz : [];

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const addText = (text, options = {}) => {
    const { size = 11, bold = false, color = rgb(0.1, 0.1, 0.1), lineGap = 5 } = options;
    const usedFont = bold ? boldFont : font;
    const words = String(text || '').split(/\s+/);
    let line = '';
    const lines = [];

    for (const word of words) {
      if (!word) continue;
      const testLine = line ? `${line} ${word}` : word;
      const lineWidth = usedFont.widthOfTextAtSize(testLine, size);
      if (lineWidth > contentWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);

    for (const l of lines) {
      if (y < margin + 28) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(l, { x: margin, y, size, font: usedFont, color });
      y -= size + lineGap;
    }
    y -= 2;
  };

  addText(title || 'Study deck', { size: 18, bold: true });
  addText(`Exported: ${new Date().toLocaleDateString()}`, { size: 9, color: rgb(0.5, 0.5, 0.5) });
  y -= 10;

  if (flashcards.length) {
    addText('Flashcards', { size: 13, bold: true, color: rgb(0.2, 0.2, 0.2) });
    flashcards.forEach((c, i) => {
      addText(`Card ${i + 1}`, { size: 10, bold: true, color: rgb(0.55, 0.38, 0.3) });
      addText(`Q: ${c.front ?? c.q ?? ''}`, { size: 10, lineGap: 3 });
      addText(`A: ${c.back ?? c.a ?? ''}`, { size: 10, lineGap: 3 });
      const meta = [c.level && `Level: ${c.level}`, c.tag && `Tag: ${c.tag}`].filter(Boolean).join(' · ');
      if (meta) addText(meta, { size: 8, color: rgb(0.45, 0.45, 0.45), lineGap: 3 });
      y -= 6;
    });
  }

  if (slides.length) {
    addText('Slides', { size: 13, bold: true, color: rgb(0.2, 0.2, 0.2) });
    slides.forEach((s, i) => {
      addText(`Slide ${i + 1}: ${s.title || 'Untitled'}`, { size: 10, bold: true });
      const bullets = Array.isArray(s.bullets) ? s.bullets : [];
      bullets.forEach((b) => addText(`• ${b}`, { size: 10, lineGap: 3 }));
      if (s.speakerNote) addText(`Speaker note: ${s.speakerNote}`, { size: 9, color: rgb(0.4, 0.4, 0.4), lineGap: 3 });
      y -= 6;
    });
  }

  if (quiz.length) {
    addText('Quiz', { size: 13, bold: true, color: rgb(0.2, 0.2, 0.2) });
    quiz.forEach((q, i) => {
      addText(`Question ${i + 1}`, { size: 10, bold: true });
      addText(q.question || '', { size: 10, lineGap: 3 });
      const choices = Array.isArray(q.choices) ? q.choices : [];
      choices.forEach((ch) => {
        const mark = ch.id === q.correctId ? '✓ ' : '  ';
        addText(`${mark}${ch.label || ch.id || ''}`, { size: 9, lineGap: 2 });
      });
      if (q.explain) addText(`Explanation: ${q.explain}`, { size: 9, color: rgb(0.4, 0.4, 0.4), lineGap: 3 });
      y -= 6;
    });
  }

  if (!flashcards.length && !slides.length && !quiz.length) {
    addText('(No structured cards in this deck yet.)', { size: 10, color: rgb(0.5, 0.5, 0.5) });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = { buildStudyDeckPdfBuffer };
