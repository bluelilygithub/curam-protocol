'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const QUESTIONNAIRE_VERSION = 'asrs-5-style-poc-v1';

const RESPONSE_OPTIONS = [
  { value: 0, label: 'Never' },
  { value: 1, label: 'Rarely' },
  { value: 2, label: 'Sometimes' },
  { value: 3, label: 'Often' },
  { value: 4, label: 'Very often' },
];

const SCALES = [
  { key: 'sustainedAttention', label: 'Sustained attention', family: 'attention', description: 'Difficulty staying with information, conversations, or tasks long enough to use them.' },
  { key: 'restlessness', label: 'Restlessness', family: 'activation', description: 'Pressure to move, shift position, or leave situations where stillness is expected.' },
  { key: 'settling', label: 'Difficulty settling', family: 'activation', description: 'Difficulty unwinding, relaxing, or letting the nervous system come down.' },
  { key: 'impulsiveSpeech', label: 'Impulsive speech', family: 'impulsivity', description: 'Speaking before the other person has finished or moving faster than the conversation.' },
  { key: 'procrastination', label: 'Last-minute pressure', family: 'planning', description: 'Putting tasks off until urgency supplies the structure or energy to act.' },
  { key: 'externalStructure', label: 'External structure', family: 'organisation', description: 'Reliance on other people or systems to keep details, time, and responsibilities organised.' },
];

const QUESTIONS = [
  { scale: 'sustainedAttention', statement: 'How often do you lose track of what someone is saying, even when you are trying to listen?' },
  { scale: 'restlessness', statement: 'How often do you feel driven to move, shift, or leave when you are expected to stay settled?' },
  { scale: 'settling', statement: 'How often is it hard to unwind or relax when you finally have time to yourself?' },
  { scale: 'impulsiveSpeech', statement: 'How often do you jump in, interrupt, or finish a thought before the other person is done?' },
  { scale: 'procrastination', statement: 'How often do you delay important tasks until the pressure becomes urgent?' },
  { scale: 'externalStructure', statement: 'How often do you rely on other people, reminders, or systems to keep everyday details in order?' },
].map((question, idx) => {
  const scale = SCALES.find((item) => item.key === question.scale);
  return {
    ...question,
    id: idx + 1,
    scaleLabel: scale.label,
    family: scale.family,
    options: RESPONSE_OPTIONS,
  };
});

function scoreBand(normalized) {
  if (normalized < 0.2) return 'Very low';
  if (normalized < 0.4) return 'Low';
  if (normalized < 0.6) return 'Middle';
  if (normalized < 0.8) return 'High';
  return 'Very high';
}

function totalBand(score) {
  if (score < 7) return { key: 'low', label: 'Lower current endorsement' };
  if (score < 14) return { key: 'moderate', label: 'Moderate current endorsement' };
  return { key: 'elevated', label: 'Elevated current endorsement' };
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

function scoreAsrs5Answers(answers) {
  const scaleScores = SCALES.map((scale) => {
    const answer = answers.find((item) => item.scale === scale.key);
    const score = Number(answer?.scoredValue || 0);
    const normalized = score / 4;
    return {
      key: scale.key,
      label: scale.label,
      family: scale.family,
      description: scale.description,
      score,
      min: 0,
      max: 4,
      normalized,
      band: scoreBand(normalized),
      itemCount: 1,
      average: score,
    };
  });

  const totalScore = scaleScores.reduce((sum, scale) => sum + Number(scale.score || 0), 0);
  const band = totalBand(totalScore);
  const highest = [...scaleScores].sort((a, b) => b.score - a.score).slice(0, 3);

  const analysis = {
    summary: `This ASRS-5-style attention/self-regulation check scored ${totalScore}/24, in the "${band.label}" range for this proof-of-concept screener.`,
    interpretation: `The strongest current signals are ${highest.map((item) => `${item.label} (${item.score}/4)`).join(', ')}. This is a reflection and screening-style prompt, not an ADHD diagnosis or clinical conclusion.`,
    rationale: {
      scoring: 'Each of the six items is scored from 0 (Never) to 4 (Very often). The total score is the sum across the six attention, activation, impulsivity, planning, and organisation prompts.',
      pattern: `Total score was ${totalScore}/24. The most endorsed items were ${highest.map((item) => `${item.label} (${item.score}/4)`).join(', ')}.`,
      totalScore,
      band,
      highest,
    },
    disclaimer: 'This is a proof-of-concept ASRS-5-style self-report screener using original wording. It is not the official ASRS-5, not a diagnosis, and not a substitute for qualified professional assessment.',
  };

  return { totalScore, band, scaleScores, analysis };
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

async function buildAsrs5PdfBuffer({ attempt }) {
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

  addText('ASRS-5-Style Attention Check Result', { size: 18, bold: true });
  addText(`Completed: ${new Date(attempt?.createdAt || Date.now()).toLocaleString()}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText('Proof of concept only. Not the official ASRS-5 and not professional advice.', { size: 9, color: rgb(0.45, 0.45, 0.45) });

  addSection('Summary');
  addText(analysis.summary || '');
  addText(analysis.interpretation || '');

  addSection('Item Areas');
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
  scoreAsrs5Answers,
  buildAsrs5PdfBuffer,
};
