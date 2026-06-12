'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
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

function cleanPdfText(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function buildRationale(attempt, analysis, answers) {
  const totalScore = Number(attempt?.totalScore || 0);
  const bandLabel = attempt?.bandLabel || 'Unlabelled range';
  const topAreas = Array.isArray(analysis?.rationale?.drivers) && analysis.rationale.drivers.length
    ? analysis.rationale.drivers
    : answers
      .filter((answer) => Number(answer.score) >= 2)
      .sort((a, b) => Number(b.score) - Number(a.score) || Number(a.questionId) - Number(b.questionId))
      .slice(0, 5)
      .map((answer) => ({
        questionId: answer.questionId,
        topic: answer.topic,
        prompt: answer.prompt,
        score: Number(answer.score),
        selectedOption: answer.optionText || answer.selectedOption,
        reflection: answer.reflection,
        reason: `${answer.topic} shaped the impression because it was answered at ${Number(answer.score)}/3: "${answer.optionText || answer.selectedOption || ''}".${answer.reflection ? ' The written reflection added extra context for this signal.' : ''}`,
      }));

  const elevatedCount = answers.filter((answer) => Number(answer.score) >= 2).length;
  const scoring = analysis?.rationale?.scoring
    || `Each question is scored from 0 to 3, so the total score is the sum of the intensity selected across all 21 questions. This attempt scored ${totalScore}/63, in the "${bandLabel}" range.`;
  const pattern = analysis?.rationale?.pattern
    || (topAreas.length
      ? `The strongest impression came from ${elevatedCount} item${elevatedCount === 1 ? '' : 's'} scored 2 or 3, especially ${topAreas.map((area) => `${area.topic} (${area.score}/3)`).join(', ')}.`
      : 'No item was scored at 2 or 3, so the result is mainly a low overall pattern rather than one dominant concern.');

  return { scoring, pattern, drivers: topAreas };
}

async function buildWellbeingPdfBuffer({ attempt }) {
  const analysis = parseMaybeJson(attempt?.analysis, {});
  const answers = parseMaybeJson(attempt?.answers, []);
  const rationale = buildRationale(attempt, analysis, answers);

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
    const { size = 10, bold = false, color = rgb(0.1, 0.1, 0.1), lineGap = 4, indent = 0 } = options;
    const usedFont = bold ? boldFont : font;
    const maxWidth = contentWidth - indent;
    const paragraphs = cleanPdfText(text).split(/\n+/);

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/);
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
        if (y < margin + 32) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(l, { x: margin + indent, y, size, font: usedFont, color });
        y -= size + lineGap;
      }
      y -= 2;
    }
  };

  const addSection = (title) => {
    y -= 6;
    addText(title, { size: 13, bold: true, color: rgb(0.18, 0.18, 0.18), lineGap: 5 });
  };

  addText('Wellbeing Check Result', { size: 18, bold: true });
  addText(`Completed: ${formatDate(attempt?.createdAt)}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText(`Score: ${Number(attempt?.totalScore || 0)}/63 - ${attempt?.bandLabel || ''}`, { size: 12, bold: true });

  if (attempt?.safetyFlag || analysis?.safetyFlag) {
    addText('Safety note: this attempt included an answer involving thoughts of death or self-harm. If there is any current risk, contact emergency services, local crisis support, or a trusted person now.', {
      size: 10,
      color: rgb(0.6, 0.05, 0.05),
    });
  }

  addSection('Analysis');
  addText(analysis?.summary || '');
  addText(analysis?.interpretation || '');

  addSection('How This Impression Was Formed');
  addText(rationale.scoring);
  addText(rationale.pattern);

  if (rationale.drivers.length) {
    addSection('Strongest Signals');
    rationale.drivers.forEach((driver, idx) => {
      addText(`${idx + 1}. ${driver.topic} (${driver.score}/3)`, { bold: true });
      addText(driver.reason || driver.selectedOption || '', { indent: 12 });
      if (driver.reflection) {
        addText(`Reflection: ${driver.reflection}`, { indent: 12, color: rgb(0.35, 0.35, 0.35) });
      }
    });
  }

  if (Array.isArray(analysis?.nextSteps) && analysis.nextSteps.length) {
    addSection('Suggested Next Steps');
    analysis.nextSteps.forEach((step) => addText(`- ${step}`));
  }

  addSection('Responses');
  answers.forEach((answer) => {
    addText(`${answer.questionId}. ${answer.topic} (${Number(answer.score)}/3)`, { bold: true });
    addText(answer.prompt || '', { indent: 12 });
    addText(`Selected: ${answer.optionText || ''}`, { indent: 12 });
    if (answer.reflection) addText(`Reflection: ${answer.reflection}`, { indent: 12, color: rgb(0.35, 0.35, 0.35) });
  });

  if (analysis?.disclaimer) {
    addSection('Disclaimer');
    addText(analysis.disclaimer, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = { buildWellbeingPdfBuffer };
