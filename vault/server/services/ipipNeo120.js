'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const QUESTIONNAIRE_VERSION = 'ipip-neo-120-poc-v1';

const RESPONSE_OPTIONS = [
  { value: 1, label: 'Very inaccurate' },
  { value: 2, label: 'Moderately inaccurate' },
  { value: 3, label: 'Neither inaccurate nor accurate' },
  { value: 4, label: 'Moderately accurate' },
  { value: 5, label: 'Very accurate' },
];

const DOMAINS = {
  N: { key: 'N', label: 'Neuroticism', description: 'Tendency toward emotional reactivity, worry, distress, and sensitivity to stress.' },
  E: { key: 'E', label: 'Extraversion', description: 'Tendency toward sociability, assertiveness, energy, and positive emotional expression.' },
  O: { key: 'O', label: 'Openness to Experience', description: 'Tendency toward imagination, curiosity, aesthetic interest, and openness to new ideas.' },
  A: { key: 'A', label: 'Agreeableness', description: 'Tendency toward trust, compassion, cooperation, and concern for others.' },
  C: { key: 'C', label: 'Conscientiousness', description: 'Tendency toward organization, persistence, reliability, and careful self-regulation.' },
};

const FACETS = [
  { code: 'N1', domain: 'N', label: 'Anxiety', items: [['+', 'Worry about things.'], ['+', 'Fear for the worst.'], ['+', 'Am afraid of many things.'], ['+', 'Get stressed out easily.']] },
  { code: 'N2', domain: 'N', label: 'Anger', items: [['+', 'Get angry easily.'], ['+', 'Get irritated easily.'], ['+', 'Lose my temper.'], ['-', 'Am not easily annoyed.']] },
  { code: 'N3', domain: 'N', label: 'Depression', items: [['+', 'Often feel blue.'], ['+', 'Dislike myself.'], ['+', 'Am often down in the dumps.'], ['-', 'Feel comfortable with myself.']] },
  { code: 'N4', domain: 'N', label: 'Self-Consciousness', items: [['+', 'Find it difficult to approach others.'], ['+', 'Am afraid to draw attention to myself.'], ['+', 'Only feel comfortable with friends.'], ['-', 'Am not bothered by difficult social situations.']] },
  { code: 'N5', domain: 'N', label: 'Immoderation', items: [['+', 'Go on binges.'], ['-', 'Rarely overindulge.'], ['-', 'Easily resist temptations.'], ['-', 'Am able to control my cravings.']] },
  { code: 'N6', domain: 'N', label: 'Vulnerability', items: [['+', 'Panic easily.'], ['+', 'Become overwhelmed by events.'], ['+', "Feel that I'm unable to deal with things."], ['-', 'Remain calm under pressure.']] },
  { code: 'E1', domain: 'E', label: 'Friendliness', items: [['+', 'Make friends easily.'], ['+', 'Feel comfortable around people.'], ['-', 'Avoid contacts with others.'], ['-', 'Keep others at a distance.']] },
  { code: 'E2', domain: 'E', label: 'Gregariousness', items: [['+', 'Love large parties.'], ['+', 'Talk to a lot of different people at parties.'], ['-', 'Prefer to be alone.'], ['-', 'Avoid crowds.']] },
  { code: 'E3', domain: 'E', label: 'Assertiveness', items: [['+', 'Take charge.'], ['+', 'Try to lead others.'], ['+', 'Take control of things.'], ['-', 'Wait for others to lead the way.']] },
  { code: 'E4', domain: 'E', label: 'Activity Level', items: [['+', 'Am always busy.'], ['+', 'Am always on the go.'], ['+', 'Do a lot in my spare time.'], ['-', 'Like to take it easy.']] },
  { code: 'E5', domain: 'E', label: 'Excitement-Seeking', items: [['+', 'Love excitement.'], ['+', 'Seek adventure.'], ['+', 'Enjoy being reckless.'], ['+', 'Act wild and crazy.']] },
  { code: 'E6', domain: 'E', label: 'Cheerfulness', items: [['+', 'Radiate joy.'], ['+', 'Have a lot of fun.'], ['+', 'Love life.'], ['+', 'Look at the bright side of life.']] },
  { code: 'O1', domain: 'O', label: 'Imagination', items: [['+', 'Have a vivid imagination.'], ['+', 'Enjoy wild flights of fantasy.'], ['+', 'Love to daydream.'], ['+', 'Like to get lost in thought.']] },
  { code: 'O2', domain: 'O', label: 'Artistic Interests', items: [['+', 'Believe in the importance of art.'], ['+', 'See beauty in things that others might not notice.'], ['-', 'Do not like poetry.'], ['-', 'Do not enjoy going to art museums.']] },
  { code: 'O3', domain: 'O', label: 'Emotionality', items: [['+', 'Experience my emotions intensely.'], ['+', "Feel others' emotions."], ['-', 'Rarely notice my emotional reactions.'], ['-', "Don't understand people who get emotional."]] },
  { code: 'O4', domain: 'O', label: 'Adventurousness', items: [['+', 'Prefer variety to routine.'], ['-', 'Prefer to stick with things that I know.'], ['-', 'Dislike changes.'], ['-', 'Am attached to conventional ways.']] },
  { code: 'O5', domain: 'O', label: 'Intellect', items: [['+', 'Love to read challenging material.'], ['-', 'Avoid philosophical discussions.'], ['-', 'Have difficulty understanding abstract ideas.'], ['-', 'Am not interested in theoretical discussions.']] },
  { code: 'O6', domain: 'O', label: 'Liberalism', items: [['+', 'Tend to vote for liberal political candidates.'], ['+', 'Believe that there is no absolute right and wrong.'], ['-', 'Tend to vote for conservative political candidates.'], ['-', 'Believe that we should be tough on crime.']] },
  { code: 'A1', domain: 'A', label: 'Trust', items: [['+', 'Trust others.'], ['+', 'Believe that others have good intentions.'], ['+', 'Trust what people say.'], ['-', 'Distrust people.']] },
  { code: 'A2', domain: 'A', label: 'Morality', items: [['-', 'Use others for my own ends.'], ['-', 'Cheat to get ahead.'], ['-', 'Take advantage of others.'], ['-', "Obstruct others' plans."]] },
  { code: 'A3', domain: 'A', label: 'Altruism', items: [['+', 'Am concerned about others.'], ['+', 'Love to help others.'], ['-', 'Am indifferent to the feelings of others.'], ['-', 'Take no time for others.']] },
  { code: 'A4', domain: 'A', label: 'Cooperation', items: [['-', 'Love a good fight.'], ['-', 'Yell at people.'], ['-', 'Insult people.'], ['-', 'Get back at others.']] },
  { code: 'A5', domain: 'A', label: 'Modesty', items: [['-', 'Believe that I am better than others.'], ['-', 'Think highly of myself.'], ['-', 'Have a high opinion of myself.'], ['-', 'Boast about my virtues.']] },
  { code: 'A6', domain: 'A', label: 'Sympathy', items: [['+', 'Sympathize with the homeless.'], ['+', 'Feel sympathy for those who are worse off than myself.'], ['-', "Am not interested in other people's problems."], ['-', 'Try not to think about the needy.']] },
  { code: 'C1', domain: 'C', label: 'Self-Efficacy', items: [['+', 'Complete tasks successfully.'], ['+', 'Excel in what I do.'], ['+', 'Handle tasks smoothly.'], ['+', 'Know how to get things done.']] },
  { code: 'C2', domain: 'C', label: 'Orderliness', items: [['+', 'Like to tidy up.'], ['-', 'Often forget to put things back in their proper place.'], ['-', 'Leave a mess in my room.'], ['-', 'Leave my belongings around.']] },
  { code: 'C3', domain: 'C', label: 'Dutifulness', items: [['+', 'Keep my promises.'], ['+', 'Tell the truth.'], ['-', 'Break rules.'], ['-', 'Break my promises.']] },
  { code: 'C4', domain: 'C', label: 'Achievement-Striving', items: [['+', "Do more than what's expected of me."], ['+', 'Work hard.'], ['-', 'Put little time and effort into my work.'], ['-', 'Do just enough work to get by.']] },
  { code: 'C5', domain: 'C', label: 'Self-Discipline', items: [['+', 'Am always prepared.'], ['+', 'Carry out my plans.'], ['-', 'Waste my time.'], ['-', 'Have difficulty starting tasks.']] },
  { code: 'C6', domain: 'C', label: 'Cautiousness', items: [['-', 'Jump into things without thinking.'], ['-', 'Make rash decisions.'], ['-', 'Rush into things.'], ['-', 'Act without thinking.']] },
];

const QUESTIONS = FACETS.flatMap((facet) => facet.items.map(([keyed, statement]) => ({
  id: 0,
  statement,
  keyed,
  facetCode: facet.code,
  facetLabel: facet.label,
  domain: facet.domain,
  domainLabel: DOMAINS[facet.domain].label,
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
    if (Number(raw.itemId) !== question.id) throw new Error(`Item ${idx + 1} was answered out of order`);
    const value = Number(raw.value);
    const option = RESPONSE_OPTIONS.find((opt) => opt.value === value);
    if (!option) throw new Error(`Invalid value for item ${question.id}`);
    const scoredValue = question.keyed === '-' ? 6 - value : value;
    return {
      itemId: question.id,
      statement: question.statement,
      keyed: question.keyed,
      facetCode: question.facetCode,
      facetLabel: question.facetLabel,
      domain: question.domain,
      domainLabel: question.domainLabel,
      value,
      optionText: option.label,
      scoredValue,
    };
  });
}

function scoreIpipAnswers(answers) {
  const facetScores = FACETS.map((facet) => {
    const facetAnswers = answers.filter((answer) => answer.facetCode === facet.code);
    const score = facetAnswers.reduce((sum, answer) => sum + answer.scoredValue, 0);
    const normalized = (score - 4) / 16;
    return {
      code: facet.code,
      label: facet.label,
      domain: facet.domain,
      domainLabel: DOMAINS[facet.domain].label,
      score,
      min: 4,
      max: 20,
      normalized,
      band: scoreBand(normalized),
    };
  });

  const domainScores = Object.values(DOMAINS).map((domain) => {
    const facets = facetScores.filter((facet) => facet.domain === domain.key);
    const score = facets.reduce((sum, facet) => sum + facet.score, 0);
    const normalized = (score - 24) / 96;
    return {
      key: domain.key,
      label: domain.label,
      description: domain.description,
      score,
      min: 24,
      max: 120,
      normalized,
      band: scoreBand(normalized),
      facets,
    };
  });

  const highestDomains = [...domainScores].sort((a, b) => b.normalized - a.normalized).slice(0, 2);
  const lowestDomains = [...domainScores].sort((a, b) => a.normalized - b.normalized).slice(0, 2);
  const strongestFacets = [...facetScores]
    .sort((a, b) => Math.abs(b.normalized - 0.5) - Math.abs(a.normalized - 0.5))
    .slice(0, 6);

  const analysis = {
    summary: `This IPIP-NEO-120 proof-of-concept profile shows the highest broad-domain endorsement in ${highestDomains.map((domain) => `${domain.label} (${domain.band})`).join(' and ')}.`,
    interpretation: `The result is based on public-domain IPIP items scored from 1 to 5, with negatively keyed items reversed. It estimates trait tendencies, not diagnoses, suitability, ability, or professional advice.`,
    rationale: {
      scoring: 'Each of the 120 statements is rated from Very inaccurate to Very accurate. Positively keyed items keep the selected value, while negatively keyed items are reverse-scored. Four items form each facet score, and six facets form each broad domain score.',
      pattern: `The strongest facet signals were ${strongestFacets.map((facet) => `${facet.label} (${facet.band})`).join(', ')}. Lower relative endorsements appeared in ${lowestDomains.map((domain) => `${domain.label} (${domain.band})`).join(' and ')}.`,
      highestDomains,
      lowestDomains,
      strongestFacets,
    },
    disclaimer: 'This is a proof-of-concept self-report personality profile inspired by the public-domain IPIP-NEO-120. It is not professional advice, clinical assessment, diagnosis, or a substitute for a qualified professional.',
  };

  return { facetScores, domainScores, analysis };
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

async function buildIpipNeoPdfBuffer({ attempt }) {
  const domainScores = parseMaybeJson(attempt?.domainScores, []);
  const facetScores = parseMaybeJson(attempt?.facetScores, []);
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

  addText('IPIP-NEO-120 Personality Result', { size: 18, bold: true });
  addText(`Completed: ${new Date(attempt?.createdAt || Date.now()).toLocaleString()}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText('Proof of concept only. Not professional advice or a substitute for a qualified professional.', { size: 9, color: rgb(0.45, 0.45, 0.45) });

  addSection('Summary');
  addText(analysis.summary || '');
  addText(analysis.interpretation || '');

  addSection('Broad Domains');
  domainScores.forEach((domain) => {
    addText(`${domain.label}: ${domain.score}/${domain.max} (${domain.band})`, { bold: true });
    addText(domain.description || '', { indent: 12, color: rgb(0.35, 0.35, 0.35) });
  });

  addSection('Facet Scores');
  facetScores.forEach((facet) => {
    addText(`${facet.code} ${facet.label}: ${facet.score}/${facet.max} (${facet.band})`);
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
  FACETS,
  QUESTIONS,
  normalizeAnswers,
  scoreIpipAnswers,
  buildIpipNeoPdfBuffer,
};
