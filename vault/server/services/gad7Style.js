'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const QUESTIONNAIRE_VERSION = 'gad-7-style-poc-v1';

const RESPONSE_OPTIONS = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
];

const QUESTIONS = [
  { id: 1, key: 'nervousness', topic: 'Nervousness', prompt: 'Over the past two weeks, how often have you felt nervous, keyed up, or on edge?' },
  { id: 2, key: 'worryControl', topic: 'Worry control', prompt: 'How often have you found it hard to stop or control worrying once it starts?' },
  { id: 3, key: 'excessiveWorry', topic: 'Excessive worry', prompt: 'How often have worries spread across several different areas of life?' },
  { id: 4, key: 'restlessness', topic: 'Restlessness', prompt: 'How often have you felt restless, agitated, or unable to settle?' },
  { id: 5, key: 'tension', topic: 'Tension', prompt: 'How often have you felt tense, wound up, or physically braced?' },
  { id: 6, key: 'irritability', topic: 'Irritability', prompt: 'How often have you become easily irritated, impatient, or reactive?' },
  { id: 7, key: 'fear', topic: 'Fear', prompt: 'How often have you felt afraid that something bad might happen?' },
].map((question) => ({ ...question, options: RESPONSE_OPTIONS }));

function bandForScore(score) {
  if (score <= 4) return { key: 'minimal', label: 'Minimal anxiety range', range: '0-4' };
  if (score <= 9) return { key: 'mild', label: 'Mild anxiety range', range: '5-9' };
  if (score <= 14) return { key: 'moderate', label: 'Moderate anxiety range', range: '10-14' };
  return { key: 'severe', label: 'Severe anxiety range', range: '15-21' };
}

function normalizeAnswers(rawAnswers) {
  if (!Array.isArray(rawAnswers)) throw new Error('answers array required');
  if (rawAnswers.length !== QUESTIONS.length) throw new Error(`Expected ${QUESTIONS.length} answers`);

  return QUESTIONS.map((question, idx) => {
    const raw = rawAnswers[idx] || {};
    if (Number(raw.questionId) !== question.id) throw new Error(`Item ${idx + 1} was answered out of order`);
    const score = Number(raw.score ?? raw.value);
    const option = RESPONSE_OPTIONS.find((opt) => opt.value === score);
    if (!option) throw new Error(`Invalid score for item ${question.id}`);
    return {
      questionId: question.id,
      key: question.key,
      topic: question.topic,
      prompt: question.prompt,
      score,
      optionText: option.label,
    };
  });
}

function scoreGad7Answers(answers) {
  const totalScore = answers.reduce((sum, answer) => sum + Number(answer.score || 0), 0);
  const band = bandForScore(totalScore);
  const topAreas = [...answers]
    .sort((a, b) => Number(b.score) - Number(a.score) || Number(a.questionId) - Number(b.questionId))
    .slice(0, 4);

  const analysis = {
    summary: `This GAD-7-style anxiety check scored ${totalScore}/21, in the "${band.label}" range for this proof-of-concept screener.`,
    interpretation: `The strongest current anxiety signals are ${topAreas.map((item) => `${item.topic} (${item.score}/3)`).join(', ')}. This is a structured self-report reflection, not a diagnosis or clinical conclusion.`,
    rationale: {
      scoring: `Each of the seven anxiety-domain items is scored from 0 to 3. The total score is the sum across all items, so ${totalScore}/21 falls in the ${band.range} range (${band.label}).`,
      pattern: `The highest endorsed areas were ${topAreas.map((item) => `${item.topic} (${item.score}/3)`).join(', ')}.`,
      totalScore,
      band,
      topAreas,
    },
    disclaimer: 'This is a proof-of-concept GAD-7-style anxiety check using original wording. It is not the official GAD-7, not a diagnosis, and not a substitute for qualified professional assessment.',
  };

  return { totalScore, band, analysis };
}

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function cleanPdfText(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

async function buildGad7PdfBuffer({ attempt }) {
  const answers = parseMaybeJson(attempt?.answers, []);
  const analysis = parseMaybeJson(attempt?.analysis, {});

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
    const paragraphs = cleanPdfText(text).split(/\n+/);
    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/);
      let line = '';
      const lines = [];
      for (const word of words) {
        if (!word) continue;
        const testLine = line ? `${line} ${word}` : word;
        if (usedFont.widthOfTextAtSize(testLine, size) > contentWidth - indent && line) {
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
    addText(title, { size: 13, bold: true, color: rgb(0.18, 0.18, 0.18) });
  };

  addText('GAD-7-Style Anxiety Check Result', { size: 18, bold: true });
  addText(`Completed: ${new Date(attempt?.createdAt || Date.now()).toLocaleString()}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText('Proof of concept only. Not the official GAD-7 and not professional advice.', { size: 9, color: rgb(0.45, 0.45, 0.45) });

  addSection('Summary');
  addText(analysis.summary || '');
  addText(analysis.interpretation || '');

  addSection('Item Responses');
  answers.forEach((answer) => {
    addText(`${answer.topic}: ${answer.score}/3 (${answer.optionText})`, { bold: true });
    addText(answer.prompt || '', { indent: 12, color: rgb(0.35, 0.35, 0.35) });
  });

  if (analysis?.rationale) {
    addSection('How This Check Was Formed');
    addText(analysis.rationale.scoring || '');
    addText(analysis.rationale.pattern || '');
  }

  if (analysis?.disclaimer) {
    addSection('Disclaimer');
    addText(analysis.disclaimer, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = {
  QUESTIONNAIRE_VERSION,
  RESPONSE_OPTIONS,
  QUESTIONS,
  normalizeAnswers,
  scoreGad7Answers,
  buildGad7PdfBuffer,
};
