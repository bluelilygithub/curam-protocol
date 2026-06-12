'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const QUESTIONNAIRE_VERSION = 'brief-cope-style-poc-v1';

const RESPONSE_OPTIONS = [
  { value: 1, label: "I haven't been doing this at all" },
  { value: 2, label: "I've been doing this a little bit" },
  { value: 3, label: "I've been doing this a medium amount" },
  { value: 4, label: "I've been doing this a lot" },
];

const SCALES = [
  {
    key: 'selfDistraction',
    label: 'Self-distraction',
    family: 'attention',
    description: 'Turning attention toward other activities or thoughts to get some distance from stress.',
    items: [
      "I've been doing something else to take my mind off things.",
      "I've been keeping busy so the stressor is not all I focus on.",
    ],
  },
  {
    key: 'activeCoping',
    label: 'Active coping',
    family: 'problem-focused',
    description: 'Taking direct steps to improve, change, or respond to the stressful situation.',
    items: [
      "I've been taking action to make the situation better.",
      "I've been doing what I can to deal with the problem directly.",
    ],
  },
  {
    key: 'denial',
    label: 'Denial',
    family: 'avoidant',
    description: 'Thinking or acting as if the stressful situation is not real or not happening.',
    items: [
      "I've been telling myself that this is not really happening.",
      "I've been trying to believe the situation is less real than it is.",
    ],
  },
  {
    key: 'substanceUse',
    label: 'Substance use',
    family: 'avoidant',
    description: 'Using alcohol, drugs, or similar substances to cope with the stress.',
    items: [
      "I've been using alcohol or other substances to feel better.",
      "I've been turning to substances to get through the stress.",
    ],
  },
  {
    key: 'emotionalSupport',
    label: 'Use of emotional support',
    family: 'support',
    description: 'Seeking comfort, understanding, or emotional care from other people.',
    items: [
      "I've been looking for emotional support from someone.",
      "I've been talking with someone who helps me feel understood.",
    ],
  },
  {
    key: 'instrumentalSupport',
    label: 'Use of instrumental support',
    family: 'support',
    description: 'Seeking advice, information, or practical help from other people.',
    items: [
      "I've been asking someone for advice about what to do.",
      "I've been seeking practical help or information from others.",
    ],
  },
  {
    key: 'behavioralDisengagement',
    label: 'Behavioral disengagement',
    family: 'avoidant',
    description: 'Reducing effort, giving up, or withdrawing from trying to handle the stressor.',
    items: [
      "I've been giving up on trying to deal with it.",
      "I've been reducing my effort because it feels too hard.",
    ],
  },
  {
    key: 'venting',
    label: 'Venting',
    family: 'emotion-focused',
    description: 'Expressing distress, frustration, or upset feelings about the situation.',
    items: [
      "I've been letting my feelings out.",
      "I've been saying things to release my frustration or distress.",
    ],
  },
  {
    key: 'positiveReframing',
    label: 'Positive reframing',
    family: 'meaning-focused',
    description: 'Trying to see the situation in a more positive, constructive, or growth-oriented way.',
    items: [
      "I've been looking for something useful or positive in the situation.",
      "I've been trying to view the stressor from a more constructive angle.",
    ],
  },
  {
    key: 'planning',
    label: 'Planning',
    family: 'problem-focused',
    description: 'Thinking through steps, options, and strategies for dealing with the stressor.',
    items: [
      "I've been making a plan for what to do next.",
      "I've been thinking carefully about steps I can take.",
    ],
  },
  {
    key: 'humor',
    label: 'Humor',
    family: 'emotion-focused',
    description: 'Using jokes, lightness, or humour to cope with the stressor.',
    items: [
      "I've been making jokes about the situation.",
      "I've been using humour to make the stress easier to bear.",
    ],
  },
  {
    key: 'acceptance',
    label: 'Acceptance',
    family: 'meaning-focused',
    description: 'Acknowledging the reality of the situation and making room for it.',
    items: [
      "I've been accepting that this has happened.",
      "I've been trying to live with the reality of the situation.",
    ],
  },
  {
    key: 'religion',
    label: 'Religion',
    family: 'meaning-focused',
    description: 'Using prayer, faith, spiritual practice, or religious meaning to cope.',
    items: [
      "I've been turning to prayer, faith, or spiritual practice.",
      "I've been looking for support or meaning through religion or spirituality.",
    ],
  },
  {
    key: 'selfBlame',
    label: 'Self-blame',
    family: 'self-evaluative',
    description: 'Criticising yourself or holding yourself responsible for the stressful situation.',
    items: [
      "I've been blaming myself for what happened.",
      "I've been criticising myself because of the situation.",
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
  if (normalized < 0.25) return 'Low';
  if (normalized < 0.5) return 'Moderate-low';
  if (normalized < 0.75) return 'Moderate-high';
  return 'High';
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

function scoreCopeAnswers(answers) {
  const scaleScores = SCALES.map((scale) => {
    const scaleAnswers = answers.filter((answer) => answer.scaleKey === scale.key);
    const score = scaleAnswers.reduce((sum, answer) => sum + answer.value, 0);
    const normalized = (score - 2) / 6;
    return {
      key: scale.key,
      label: scale.label,
      family: scale.family,
      description: scale.description,
      score,
      min: 2,
      max: 8,
      normalized,
      band: scoreBand(normalized),
    };
  });

  const strongest = [...scaleScores].sort((a, b) => b.normalized - a.normalized).slice(0, 5);
  const familyScores = Object.values(scaleScores.reduce((acc, scale) => {
    if (!acc[scale.family]) acc[scale.family] = { key: scale.family, score: 0, count: 0 };
    acc[scale.family].score += scale.normalized;
    acc[scale.family].count += 1;
    return acc;
  }, {})).map((family) => ({
    ...family,
    normalized: family.count ? family.score / family.count : 0,
    band: scoreBand(family.count ? family.score / family.count : 0),
  }));

  const analysis = {
    summary: `This Brief COPE-style profile shows the most used coping responses as ${strongest.map((scale) => `${scale.label} (${scale.band})`).join(', ')}.`,
    interpretation: 'There is no recommended overall COPE total score. The useful view is the pattern across individual coping strategies and how strongly each one was endorsed.',
    rationale: {
      scoring: 'Each item is rated from 1 to 4. Two items form each coping strategy score, with no reverse scoring. Higher scores mean more frequent use of that coping response.',
      pattern: `The strongest reported coping strategies were ${strongest.map((scale) => `${scale.label} (${scale.score}/8)`).join(', ')}.`,
      strongest,
      familyScores,
    },
    disclaimer: 'This is a Brief COPE-style proof-of-concept coping check using original item wording. It is not professional advice, diagnosis, or a substitute for a qualified professional. Inspired by Carver (1997), Brief COPE.',
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

async function buildCopePdfBuffer({ attempt }) {
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

  addText('Brief COPE-Style Coping Result', { size: 18, bold: true });
  addText(`Completed: ${new Date(attempt?.createdAt || Date.now()).toLocaleString()}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText('Proof of concept only. Not professional advice or a substitute for a qualified professional.', { size: 9, color: rgb(0.45, 0.45, 0.45) });

  addSection('Summary');
  addText(analysis.summary || '');
  addText(analysis.interpretation || '');

  addSection('Coping Strategy Scores');
  scaleScores.forEach((scale) => {
    addText(`${scale.label}: ${scale.score}/${scale.max} (${scale.band})`, { bold: true });
    addText(scale.description || '', { indent: 12, color: rgb(0.35, 0.35, 0.35) });
  });

  addSection('How This Profile Was Formed');
  addText(analysis?.rationale?.scoring || '');
  addText(analysis?.rationale?.pattern || '');

  addSection('Responses');
  answers.forEach((answer) => {
    addText(`${answer.questionId}. ${answer.scaleLabel}: ${answer.value}/4 - ${answer.optionText}`, { bold: true });
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
  scoreCopeAnswers,
  buildCopePdfBuffer,
};
