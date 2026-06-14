'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function cleanPdfText(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function normaliseProfile(profile) {
  const safeProfile = profile && typeof profile === 'object' ? profile : {};
  return {
    summary: String(safeProfile.summary || ''),
    sections: Array.isArray(safeProfile.sections) ? safeProfile.sections : [],
    questions: Array.isArray(safeProfile.questions) ? safeProfile.questions : [],
    caveat: String(safeProfile.caveat || ''),
    generatedByModel: !!safeProfile.generatedByModel,
  };
}

function pdfTextBlocks(value) {
  const text = cleanPdfText(value).trim();
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((block) => block.split(/\n/).map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length);
}

async function buildCombinedProfilePdfBuffer({ profile, sourceAttempts }) {
  const safeProfile = normaliseProfile(profile);
  const sources = sourceAttempts && typeof sourceAttempts === 'object' ? sourceAttempts : {};

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensureSpace = (height = 32) => {
    if (y < margin + height) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const addText = (text, options = {}) => {
    const {
      size = 10,
      bold = false,
      color = rgb(0.1, 0.1, 0.1),
      lineGap = 4,
      indent = 0,
      lineBreakGap = 2,
      paragraphGap = 8,
    } = options;
    const usedFont = bold ? boldFont : font;
    const maxWidth = contentWidth - indent;
    const blocks = pdfTextBlocks(text);

    for (const block of blocks) {
      block.forEach((sourceLine, lineIdx) => {
        const words = sourceLine.trim().split(/\s+/);
        let line = '';
        const lines = [];

        for (const word of words) {
          if (!word) continue;
          const testLine = line ? `${line} ${word}` : word;
          const lineWidth = usedFont.widthOfTextAtSize(testLine, size);
          if (lineWidth > maxWidth && line) {
            lines.push(line);
            line = word;
          } else {
            line = testLine;
          }
        }
        if (line) lines.push(line);
        if (!lines.length) lines.push('');

        for (const l of lines) {
          ensureSpace();
          page.drawText(l, { x: margin + indent, y, size, font: usedFont, color });
          y -= size + lineGap;
        }
        if (lineIdx < block.length - 1) y -= lineBreakGap;
      });
      y -= paragraphGap;
    }
  };

  const addSection = (title) => {
    y -= 6;
    ensureSpace(48);
    addText(title, { size: 13, bold: true, color: rgb(0.18, 0.18, 0.18), lineGap: 5 });
  };

  addText('Combined Wellbeing Profile', { size: 18, bold: true });
  addText(`Generated: ${formatDate(new Date())}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText(
    safeProfile.generatedByModel
      ? 'Generated from the scored pattern using the configured model.'
      : 'Generated from deterministic fallback guidance.',
    { size: 9, color: rgb(0.45, 0.45, 0.45) }
  );

  addSection('Source Results');
  [
    ['Mood check', sources.mood?.createdAt],
    ['IPIP-NEO-120', sources.ipip?.createdAt],
    ['HEXACO-60-style check', sources.hexaco?.createdAt],
    ['CERQ-style check', sources.cerq?.createdAt],
    ['Brief COPE-style check', sources.cope?.createdAt],
  ].forEach(([label, createdAt]) => addText(`${label}: ${createdAt ? formatDate(createdAt) : 'latest completed result'}`));

  if (safeProfile.summary) {
    addSection('Summary');
    addText(safeProfile.summary);
  }

  safeProfile.sections
    .filter((section) => section && (section.title || section.body))
    .forEach((section) => {
      addSection(section.title || 'Profile section');
      addText(section.body || '');
    });

  if (safeProfile.questions.length) {
    addSection('Reflection Questions');
    safeProfile.questions.forEach((question, idx) => addText(`${idx + 1}. ${question}`));
  }

  if (safeProfile.caveat) {
    addSection('Caveat');
    addText(safeProfile.caveat, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = { buildCombinedProfilePdfBuffer };
