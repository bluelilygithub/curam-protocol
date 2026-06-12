'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const QUESTIONNAIRE_VERSION = 'cerq-style-cognitive-coping-poc-v1';

const RESPONSE_OPTIONS = [
  { value: 1, label: 'Almost never' },
  { value: 2, label: 'Rarely' },
  { value: 3, label: 'Sometimes' },
  { value: 4, label: 'Often' },
  { value: 5, label: 'Almost always' },
];

const SCALES = [
  {
    key: 'selfBlame',
    label: 'Self-blame',
    family: 'less-helpful',
    description: 'Attributing the cause or responsibility for a difficult event mainly to yourself.',
    items: [
      'I think about what I did wrong when something difficult happens.',
      'I keep returning to ways I might have caused the situation.',
      'I tell myself that the outcome says something negative about me.',
      'I feel responsible even when the situation had many causes.',
    ],
  },
  {
    key: 'acceptance',
    label: 'Acceptance',
    family: 'mixed',
    description: 'Acknowledging that a difficult event happened and that some parts cannot be changed.',
    items: [
      'I remind myself that this is something that has happened.',
      'I try to make room for the facts of the situation.',
      'I tell myself that some parts of the event cannot be undone.',
      'I try to stop fighting with reality long enough to respond clearly.',
    ],
  },
  {
    key: 'rumination',
    label: 'Rumination',
    family: 'less-helpful',
    description: 'Repetitively thinking about feelings, causes, and consequences of the event.',
    items: [
      'I keep thinking about how upset the event made me feel.',
      'I replay the situation in my mind many times.',
      'I find it hard to stop analysing why I feel this way.',
      'I spend a lot of mental energy going over the same thoughts.',
    ],
  },
  {
    key: 'positiveRefocusing',
    label: 'Positive refocusing',
    family: 'helpful',
    description: 'Turning attention toward pleasant, calming, or meaningful thoughts after the event.',
    items: [
      'I deliberately think about something pleasant for a while.',
      'I shift my attention to memories or ideas that settle me.',
      'I focus on something enjoyable so the event is not all I think about.',
      'I give my mind a break by thinking about something positive.',
    ],
  },
  {
    key: 'planning',
    label: 'Refocus on planning',
    family: 'helpful',
    description: 'Thinking about practical next steps and ways to handle the situation.',
    items: [
      'I think through what I can do next.',
      'I make a small plan for how to handle the situation.',
      'I consider which action is most useful now.',
      'I break the problem into steps I can manage.',
    ],
  },
  {
    key: 'positiveReappraisal',
    label: 'Positive reappraisal',
    family: 'helpful',
    description: 'Looking for meaning, growth, learning, or a constructive angle in the event.',
    items: [
      'I look for what the experience might teach me.',
      'I try to find a constructive meaning in what happened.',
      'I consider whether the event could help me grow in some way.',
      'I look for a different interpretation that gives me more room to move.',
    ],
  },
  {
    key: 'perspective',
    label: 'Putting into perspective',
    family: 'helpful',
    description: 'Relativising the event by considering time, scale, context, or comparison.',
    items: [
      'I remind myself that the event may feel different with time.',
      'I compare this situation with other things I have handled.',
      'I try to see the event as one part of a larger picture.',
      'I ask myself how important this will feel later.',
    ],
  },
  {
    key: 'catastrophizing',
    label: 'Catastrophizing',
    family: 'less-helpful',
    description: 'Emphasising the worst possible meaning or consequences of the event.',
    items: [
      'I think about how terrible the consequences could become.',
      'I imagine the situation getting much worse.',
      'I tell myself this is one of the worst things that could happen.',
      'I focus on worst-case outcomes even before they are likely.',
    ],
  },
  {
    key: 'otherBlame',
    label: 'Other-blame',
    family: 'less-helpful',
    description: 'Attributing the cause or responsibility for the difficult event mainly to others.',
    items: [
      'I focus on what other people did wrong.',
      'I think someone else is mainly responsible for what happened.',
      'I keep returning to how another person caused the situation.',
      'I feel stuck on the unfairness of what others did.',
    ],
  },
];

const QUESTIONS = SCALES.flatMap((scale) => scale.items.map((prompt) => ({
  id: 0,
  scaleKey: scale.key,
  scaleLabel: scale.label,
  family: scale.family,
  prompt,
  options: RESPONSE_OPTIONS,
}))).map((question, idx) => ({ ...question, id: idx + 1 }));

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
    if (Number(raw.questionId) !== question.id) throw new Error(`Question ${idx + 1} was answered out of order`);
    const value = Number(raw.value);
    const option = RESPONSE_OPTIONS.find((opt) => opt.value === value);
    if (!option) throw new Error(`Invalid value for question ${question.id}`);
    return {
      questionId: question.id,
      scaleKey: question.scaleKey,
      scaleLabel: question.scaleLabel,
      family: question.family,
      prompt: question.prompt,
      value,
      optionText: option.label,
    };
  });
}

function scoreCerqAnswers(answers) {
  const scaleScores = SCALES.map((scale) => {
    const scaleAnswers = answers.filter((answer) => answer.scaleKey === scale.key);
    const score = scaleAnswers.reduce((sum, answer) => sum + answer.value, 0);
    const normalized = (score - 4) / 16;
    return {
      key: scale.key,
      label: scale.label,
      family: scale.family,
      description: scale.description,
      score,
      min: 4,
      max: 20,
      normalized,
      band: scoreBand(normalized),
    };
  });

  const helpful = scaleScores.filter((scale) => scale.family === 'helpful');
  const lessHelpful = scaleScores.filter((scale) => scale.family === 'less-helpful');
  const helpfulMean = helpful.reduce((sum, scale) => sum + scale.normalized, 0) / helpful.length;
  const lessHelpfulMean = lessHelpful.reduce((sum, scale) => sum + scale.normalized, 0) / lessHelpful.length;
  const strongest = [...scaleScores].sort((a, b) => b.normalized - a.normalized).slice(0, 4);

  const analysis = {
    summary: `This CERQ-style cognitive coping profile shows the most frequent strategies as ${strongest.map((scale) => `${scale.label} (${scale.band})`).join(', ')}.`,
    interpretation: `The helpful-strategy average is ${scoreBand(helpfulMean)}, while the less-helpful-strategy average is ${scoreBand(lessHelpfulMean)}. This describes self-reported thinking patterns after stress, not a diagnosis or professional advice.`,
    rationale: {
      scoring: 'Each item is rated from 1 to 5. Four original proof-of-concept items form each strategy score, with higher scores meaning that strategy is used more often.',
      pattern: `The strongest reported cognitive strategies were ${strongest.map((scale) => `${scale.label} (${scale.score}/20)`).join(', ')}.`,
      helpfulMean,
      lessHelpfulMean,
      strongest,
    },
    disclaimer: 'This is a CERQ-style proof-of-concept cognitive coping check using original item wording. It is not the official CERQ, not professional advice, and not a substitute for a qualified professional.',
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

async function buildCerqPdfBuffer({ attempt }) {
  const scaleScores = parseMaybeJson(attempt?.scaleScores, []);
  const analysis = parseMaybeJson(attempt?.analysis, {});
  const answers = parseMaybeJson(attempt?.answers, []);

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

  addText('CERQ-Style Cognitive Coping Result', { size: 18, bold: true });
  addText(`Completed: ${new Date(attempt?.createdAt || Date.now()).toLocaleString()}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText('Proof of concept only. Not the official CERQ, professional advice, or a substitute for a qualified professional.', { size: 9, color: rgb(0.45, 0.45, 0.45) });

  addSection('Summary');
  addText(analysis.summary || '');
  addText(analysis.interpretation || '');

  addSection('Strategy Scores');
  scaleScores.forEach((scale) => {
    addText(`${scale.label}: ${scale.score}/${scale.max} (${scale.band})`, { bold: true });
    addText(scale.description || '', { indent: 12, color: rgb(0.35, 0.35, 0.35) });
  });

  addSection('How This Profile Was Formed');
  addText(analysis?.rationale?.scoring || '');
  addText(analysis?.rationale?.pattern || '');

  addSection('Responses');
  answers.forEach((answer) => {
    addText(`${answer.questionId}. ${answer.scaleLabel}: ${answer.value}/5 - ${answer.optionText}`, { bold: true });
    addText(answer.prompt || '', { indent: 12 });
  });

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
  scoreCerqAnswers,
  buildCerqPdfBuffer,
};
