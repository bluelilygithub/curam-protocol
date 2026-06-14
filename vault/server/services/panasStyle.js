'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const QUESTIONNAIRE_VERSION = 'panas-style-poc-v1';

const RESPONSE_OPTIONS = [
  { value: 1, label: 'Very slightly or not at all' },
  { value: 2, label: 'A little' },
  { value: 3, label: 'Moderately' },
  { value: 4, label: 'Quite a bit' },
  { value: 5, label: 'Extremely' },
];

const SCALES = [
  {
    key: 'positiveAffect',
    label: 'Positive affect',
    family: 'positive',
    description: 'Current access to energy, interest, enthusiasm, confidence, and engagement.',
    items: [
      'Interested and mentally engaged',
      'Alert and switched on',
      'Energetic or activated',
      'Inspired or uplifted',
      'Confident in yourself',
      'Motivated to act',
      'Focused and attentive',
      'Proud of something about yourself',
      'Excited or eager',
      'Determined to keep going',
    ],
  },
  {
    key: 'negativeAffect',
    label: 'Negative affect',
    family: 'negative',
    description: 'Current intensity of distressing affect such as worry, irritation, guilt, fear, or inner tension.',
    items: [
      'Distressed or upset',
      'Irritable or angry',
      'Guilty or self-critical',
      'Anxious or worried',
      'Ashamed or embarrassed',
      'Nervous or on edge',
      'Afraid or threatened',
      'Hostile or resentful',
      'Jittery or unsettled',
      'Overwhelmed by unpleasant feelings',
    ],
  },
];

const QUESTIONS = SCALES.flatMap((scale) => scale.items.map((statement) => ({
  id: 0,
  statement,
  scale: scale.key,
  scaleLabel: scale.label,
  family: scale.family,
}))).map((question, idx) => ({ ...question, id: idx + 1, options: RESPONSE_OPTIONS }));

function scoreBand(normalized) {
  if (normalized < 0.2) return 'Very low';
  if (normalized < 0.4) return 'Low';
  if (normalized < 0.6) return 'Middle';
  if (normalized < 0.8) return 'High';
  return 'Very high';
}

function normalizeAnswers(rawAnswers) {
  if (!Array.isArray(rawAnswers)) throw new Error('answers array required');
  if (rawAnswers.length !== QUESTIONS.length) throw new Error(`Expected ${QUESTIONS.length} answers`);

  return QUESTIONS.map((question, idx) => {
    const raw = rawAnswers[idx] || {};
    if (Number(raw.questionId) !== question.id) throw new Error(`Item ${idx + 1} was answered out of order`);
    const value = Number(raw.value);
    const option = RESPONSE_OPTIONS.find((opt) => opt.value === value);
    if (!option) throw new Error(`Invalid value for item ${question.id}`);
    return {
      questionId: question.id,
      statement: question.statement,
      scale: question.scale,
      scaleLabel: question.scaleLabel,
      family: question.family,
      value,
      optionText: option.label,
      scoredValue: value,
    };
  });
}

function scorePanasAnswers(answers) {
  const scaleScores = SCALES.map((scale) => {
    const scaleAnswers = answers.filter((answer) => answer.scale === scale.key);
    const score = scaleAnswers.reduce((sum, answer) => sum + answer.scoredValue, 0);
    const normalized = (score - 10) / 40;
    return {
      key: scale.key,
      label: scale.label,
      family: scale.family,
      description: scale.description,
      score,
      min: 10,
      max: 50,
      normalized,
      band: scoreBand(normalized),
      itemCount: scaleAnswers.length,
      average: score / Math.max(scaleAnswers.length, 1),
    };
  });

  const positive = scaleScores.find((scale) => scale.key === 'positiveAffect');
  const negative = scaleScores.find((scale) => scale.key === 'negativeAffect');
  const balance = Number(positive?.score || 0) - Number(negative?.score || 0);
  const balanceLabel = balance >= 10 ? 'positive affect clearly higher'
    : balance >= 3 ? 'positive affect somewhat higher'
      : balance <= -10 ? 'negative affect clearly higher'
        : balance <= -3 ? 'negative affect somewhat higher'
          : 'positive and negative affect relatively balanced';

  const analysis = {
    summary: `This PANAS-style affect check shows ${positive?.label || 'positive affect'} in the ${positive?.band || 'unscored'} range and ${negative?.label || 'negative affect'} in the ${negative?.band || 'unscored'} range.`,
    interpretation: `The affect balance is ${balance} (${balanceLabel}). This is a snapshot of current emotional tone, not a diagnosis or a stable trait profile.`,
    rationale: {
      scoring: 'Each of the 20 affect statements is rated from 1 to 5. Ten items contribute to positive affect and ten items contribute to negative affect. The two totals are interpreted separately and then compared as an affect-balance snapshot.',
      pattern: `Positive affect scored ${positive?.score || 0}/50 (${positive?.band || 'unscored'}). Negative affect scored ${negative?.score || 0}/50 (${negative?.band || 'unscored'}). The balance score was ${balance}, described as ${balanceLabel}.`,
      balance,
      balanceLabel,
    },
    disclaimer: 'This is a proof-of-concept PANAS-style self-report affect check using original wording. It is not the official PANAS, not a diagnosis, and not a substitute for qualified professional advice.',
  };

  return { scaleScores, analysis };
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

async function buildPanasPdfBuffer({ attempt }) {
  const scaleScores = parseMaybeJson(attempt?.scaleScores, []);
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

  addText('PANAS-Style Affect Check Result', { size: 18, bold: true });
  addText(`Completed: ${new Date(attempt?.createdAt || Date.now()).toLocaleString()}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText('Proof of concept only. Not the official PANAS and not professional advice.', { size: 9, color: rgb(0.45, 0.45, 0.45) });

  addSection('Summary');
  addText(analysis.summary || '');
  addText(analysis.interpretation || '');

  addSection('Affect Scores');
  scaleScores.forEach((scale) => {
    addText(`${scale.label}: ${scale.score}/${scale.max} (${scale.band})`, { bold: true });
    addText(scale.description || '', { indent: 12, color: rgb(0.35, 0.35, 0.35) });
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
  SCALES,
  QUESTIONS,
  normalizeAnswers,
  scorePanasAnswers,
  buildPanasPdfBuffer,
};
