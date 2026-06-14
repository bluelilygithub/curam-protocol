'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const QUESTIONNAIRE_VERSION = 'hexaco-60-style-poc-v1';

const RESPONSE_OPTIONS = [
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neither agree nor disagree' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly agree' },
];

const DOMAINS = {
  HH: {
    key: 'HH',
    label: 'Honesty-Humility',
    description: 'Tendency toward sincerity, fairness, modesty, and low interest in exploiting status or advantage.',
  },
  EM: {
    key: 'EM',
    label: 'Emotionality',
    description: 'Tendency toward emotional sensitivity, attachment, caution, and concern in threatening or relationally important situations.',
  },
  EX: {
    key: 'EX',
    label: 'Extraversion',
    description: 'Tendency toward social confidence, energy, positive expression, and comfort being visible with others.',
  },
  AG: {
    key: 'AG',
    label: 'Agreeableness',
    description: 'Tendency toward patience, forgiveness, flexibility, and lower anger or retaliation under interpersonal strain.',
  },
  CO: {
    key: 'CO',
    label: 'Conscientiousness',
    description: 'Tendency toward organization, diligence, prudence, and careful follow-through.',
  },
  OP: {
    key: 'OP',
    label: 'Openness to Experience',
    description: 'Tendency toward curiosity, imagination, aesthetic interest, and willingness to consider new ideas.',
  },
};

const DOMAIN_ITEMS = {
  HH: [
    ['+', 'I try to be straightforward even when a smoother answer would benefit me.'],
    ['+', 'I would feel uncomfortable taking credit for someone else’s work.'],
    ['-', 'If I could gain an advantage without being caught, I would seriously consider it.'],
    ['+', 'I do not need special treatment to feel respected.'],
    ['-', 'I enjoy showing that I have more status or influence than other people.'],
    ['+', 'I would rather be fair than win by bending the rules.'],
    ['+', 'I can admit when I am wrong without feeling humiliated.'],
    ['-', 'I sometimes flatter people mainly to get something from them.'],
    ['+', 'I am cautious about using other people for my own ends.'],
    ['-', 'I would be tempted to keep extra money if a mistake was unlikely to be noticed.'],
  ],
  EM: [
    ['+', 'I feel unsettled when someone close to me is upset.'],
    ['+', 'I can become anxious when the outcome really matters.'],
    ['-', 'I rarely need emotional support from other people.'],
    ['+', 'I tend to be careful when a situation feels physically or emotionally risky.'],
    ['+', 'Strong feelings can stay with me after an event has passed.'],
    ['-', 'I usually stay emotionally detached even in serious situations.'],
    ['+', 'I worry about losing people or relationships that matter to me.'],
    ['+', 'I notice subtle signs that someone may be hurt or unsafe.'],
    ['-', 'It takes a lot for fear or concern to affect my choices.'],
    ['+', 'I often feel protective toward people who are vulnerable.'],
  ],
  EX: [
    ['+', 'I usually feel comfortable introducing myself to new people.'],
    ['+', 'I find it natural to speak up in a group.'],
    ['-', 'I often hold back because I do not want attention on me.'],
    ['+', 'Spending time with people often gives me energy.'],
    ['+', 'I can express enthusiasm openly when something goes well.'],
    ['-', 'I prefer to stay in the background even when I have something useful to add.'],
    ['+', 'I tend to recover confidence after social awkwardness.'],
    ['+', 'I enjoy occasions where people are lively and expressive.'],
    ['-', 'I often doubt whether others will want me included.'],
    ['+', 'I am usually willing to take the first step socially.'],
  ],
  AG: [
    ['+', 'I can let go of irritation once an issue has been discussed.'],
    ['-', 'When someone annoys me, I find it hard not to show it.'],
    ['+', 'I try to understand the pressure someone was under before judging them.'],
    ['+', 'I can compromise without feeling that I have lost.'],
    ['-', 'I tend to remember insults for a long time.'],
    ['+', 'I prefer calming a conflict to proving that I was right.'],
    ['-', 'If someone treats me badly, I want them to feel the consequences.'],
    ['+', 'I can accept criticism without immediately becoming defensive.'],
    ['+', 'I usually give people a chance to explain themselves.'],
    ['-', 'I become impatient quickly when people do things inefficiently.'],
  ],
  CO: [
    ['+', 'I like to plan important tasks before starting them.'],
    ['+', 'I usually finish what I say I will do.'],
    ['-', 'I often leave important details until the last minute.'],
    ['+', 'I check my work when mistakes would matter.'],
    ['+', 'I can keep working steadily even when the task is dull.'],
    ['-', 'I am easily pulled away from a task by whatever feels more interesting.'],
    ['+', 'I prefer having systems that help me stay organised.'],
    ['+', 'I think through likely consequences before making important decisions.'],
    ['-', 'My spaces or files often become disorganised before I notice.'],
    ['+', 'I can delay a short-term reward to complete something important.'],
  ],
  OP: [
    ['+', 'I enjoy exploring ideas that challenge my usual way of thinking.'],
    ['+', 'Music, art, stories, or design can strongly affect me.'],
    ['-', 'I prefer familiar routines over experimenting with new approaches.'],
    ['+', 'I am curious about why people see the world differently.'],
    ['+', 'I enjoy imagining possibilities that do not yet exist.'],
    ['-', 'Abstract theories usually feel like a waste of time to me.'],
    ['+', 'I like learning about cultures, histories, or viewpoints unlike my own.'],
    ['+', 'I often notice patterns, symbolism, or meaning in ordinary experiences.'],
    ['-', 'I tend to dismiss unusual ideas before considering them carefully.'],
    ['+', 'I enjoy creative problem-solving when there is no obvious answer.'],
  ],
};

const QUESTIONS = Object.values(DOMAINS).flatMap((domain) => (
  DOMAIN_ITEMS[domain.key].map(([keyed, statement], idx) => ({
    id: 0,
    statement,
    keyed,
    domain: domain.key,
    domainLabel: domain.label,
    facetLabel: `${domain.label} item ${idx + 1}`,
  }))
)).map((question, idx) => ({ ...question, id: idx + 1, options: RESPONSE_OPTIONS }));

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
    if (Number(raw.itemId) !== question.id) throw new Error(`Item ${idx + 1} was answered out of order`);
    const value = Number(raw.value);
    const option = RESPONSE_OPTIONS.find((opt) => opt.value === value);
    if (!option) throw new Error(`Invalid value for item ${question.id}`);
    const scoredValue = question.keyed === '-' ? 6 - value : value;
    return {
      itemId: question.id,
      statement: question.statement,
      keyed: question.keyed,
      domain: question.domain,
      domainLabel: question.domainLabel,
      facetLabel: question.facetLabel,
      value,
      optionText: option.label,
      scoredValue,
    };
  });
}

function scoreHexacoAnswers(answers) {
  const domainScores = Object.values(DOMAINS).map((domain) => {
    const domainAnswers = answers.filter((answer) => answer.domain === domain.key);
    const score = domainAnswers.reduce((sum, answer) => sum + answer.scoredValue, 0);
    const normalized = (score - 10) / 40;
    return {
      key: domain.key,
      label: domain.label,
      description: domain.description,
      score,
      min: 10,
      max: 50,
      normalized,
      band: scoreBand(normalized),
      itemCount: domainAnswers.length,
    };
  });

  const highestDomains = [...domainScores].sort((a, b) => b.normalized - a.normalized).slice(0, 2);
  const lowestDomains = [...domainScores].sort((a, b) => a.normalized - b.normalized).slice(0, 2);

  const analysis = {
    summary: `This HEXACO-60-style proof-of-concept profile shows the highest relative endorsement in ${highestDomains.map((domain) => `${domain.label} (${domain.band})`).join(' and ')}.`,
    interpretation: 'The result estimates six broad self-reported personality tendencies. It should be read as a reflection tool, not as diagnosis, clinical assessment, hiring assessment, or professional advice.',
    rationale: {
      scoring: 'Each of the 60 statements is rated from Strongly disagree to Strongly agree. Negatively keyed items are reverse-scored. Ten items contribute to each of the six HEXACO-style domains.',
      pattern: `The highest relative domains were ${highestDomains.map((domain) => `${domain.label} (${domain.band})`).join(' and ')}. Lower relative endorsements appeared in ${lowestDomains.map((domain) => `${domain.label} (${domain.band})`).join(' and ')}.`,
      highestDomains,
      lowestDomains,
    },
    disclaimer: 'This is a proof-of-concept HEXACO-style self-report profile using original item wording. It is not the official HEXACO-PI-R, not professional advice, and not a substitute for a qualified professional.',
  };

  return { domainScores, analysis };
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

async function buildHexacoPdfBuffer({ attempt }) {
  const domainScores = parseMaybeJson(attempt?.domainScores, []);
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

  addText('HEXACO-60-Style Personality Result', { size: 18, bold: true });
  addText(`Completed: ${new Date(attempt?.createdAt || Date.now()).toLocaleString()}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText('Proof of concept only. Not the official HEXACO-PI-R and not professional advice.', { size: 9, color: rgb(0.45, 0.45, 0.45) });

  addSection('Summary');
  addText(analysis.summary || '');
  addText(analysis.interpretation || '');

  addSection('Domains');
  domainScores.forEach((domain) => {
    addText(`${domain.label}: ${domain.score}/${domain.max} (${domain.band})`, { bold: true });
    addText(domain.description || '', { indent: 12, color: rgb(0.35, 0.35, 0.35) });
  });

  if (analysis?.rationale) {
    addSection('How This Profile Was Formed');
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
  DOMAINS,
  QUESTIONS,
  normalizeAnswers,
  scoreHexacoAnswers,
  buildHexacoPdfBuffer,
};
