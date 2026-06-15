'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');
const sendEmail = require('../utils/sendEmail');
const { getAppUrl } = require('../utils/appUrl');
const { buildWellbeingPdfBuffer } = require('../services/wellbeingPdf');
const { buildCombinedProfilePdfBuffer } = require('../services/combinedProfilePdf');
const { buildWellbeingVisualPdfBuffer } = require('../services/wellbeingVisualPdf');
const {
  buildWellbeingSlideshowData,
  buildWellbeingSlideshowBuffer,
} = require('../services/wellbeingSlideshow');
const {
  DEFAULT_WELLBEING_INVITE_SUBJECT,
  DEFAULT_WELLBEING_INVITE_BODY,
  renderWellbeingInviteHtml,
} = require('../services/wellbeingInviteTemplate');
const {
  QUESTIONNAIRE_VERSION: IPIP_QUESTIONNAIRE_VERSION,
  QUESTIONS: IPIP_QUESTIONS,
  FACETS: IPIP_FACETS,
  DOMAINS: IPIP_DOMAINS,
  normalizeAnswers: normalizeIpipAnswers,
  scoreIpipAnswers,
  buildIpipNeoPdfBuffer,
} = require('../services/ipipNeo120');
const {
  QUESTIONNAIRE_VERSION: HEXACO_QUESTIONNAIRE_VERSION,
  QUESTIONS: HEXACO_QUESTIONS,
  DOMAINS: HEXACO_DOMAINS,
  normalizeAnswers: normalizeHexacoAnswers,
  scoreHexacoAnswers,
  buildHexacoPdfBuffer,
} = require('../services/hexaco60Style');
const {
  QUESTIONNAIRE_VERSION: CERQ_QUESTIONNAIRE_VERSION,
  QUESTIONS: CERQ_QUESTIONS,
  SCALES: CERQ_SCALES,
  normalizeAnswers: normalizeCerqAnswers,
  scoreCerqAnswers,
  buildCerqPdfBuffer,
} = require('../services/cerqStyle');
const {
  QUESTIONNAIRE_VERSION: COPE_QUESTIONNAIRE_VERSION,
  QUESTIONS: COPE_QUESTIONS,
  SCALES: COPE_SCALES,
  normalizeAnswers: normalizeCopeAnswers,
  scoreCopeAnswers,
  buildCopePdfBuffer,
} = require('../services/briefCopeStyle');
const {
  generateModelInsight,
  generateCombinedProfile,
  latestScoreLinesFromScales,
  WELLBEING_MODULES,
  buildCombinedScores,
  buildCombinedFallback,
  buildModuleFallback,
  describeSuggestedNextSteps,
} = require('../services/wellbeingModelInsights');
const {
  QUESTIONNAIRE_VERSION: PANAS_QUESTIONNAIRE_VERSION,
  QUESTIONS: PANAS_QUESTIONS,
  SCALES: PANAS_SCALES,
  normalizeAnswers: normalizePanasAnswers,
  scorePanasAnswers,
  buildPanasPdfBuffer,
} = require('../services/panasStyle');
const {
  QUESTIONNAIRE_VERSION: ASRS5_QUESTIONNAIRE_VERSION,
  QUESTIONS: ASRS5_QUESTIONS,
  SCALES: ASRS5_SCALES,
  normalizeAnswers: normalizeAsrs5Answers,
  scoreAsrs5Answers,
  buildAsrs5PdfBuffer,
} = require('../services/asrs5Style');
const {
  QUESTIONNAIRE_VERSION: GAD7_QUESTIONNAIRE_VERSION,
  QUESTIONS: GAD7_QUESTIONS,
  normalizeAnswers: normalizeGad7Answers,
  scoreGad7Answers,
  buildGad7PdfBuffer,
} = require('../services/gad7Style');

const QUESTIONNAIRE_VERSION = 'wellbeing-check-v1';
const SALT_ROUNDS = 12;
const WELLBEING_INVITE_SUBJECT_KEY = 'wellbeing_invite_subject';
const WELLBEING_INVITE_BODY_KEY = 'wellbeing_invite_body';

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

const QUESTIONS = [
  {
    id: 1,
    key: 'sadness',
    topic: 'Sadness',
    prompt: 'Over the past two weeks, how often have you felt sad, down, or low in mood?',
    reflectionPrompt: 'What was the most recent moment in the past few days when your mood dropped? What seemed to trigger it?',
    options: [
      'I have not felt noticeably sad or low.',
      'I have felt sad or low some of the time.',
      'I have felt sad or low much of the time.',
      'I have felt extremely sad or low most of the time.',
    ],
  },
  {
    id: 2,
    key: 'pessimism',
    topic: 'Pessimism',
    prompt: 'How hopeful or discouraged have you felt about the near future?',
    reflectionPrompt: 'When you imagine life one month from now, what do you expect might be harder? Is there a counterexample where things improved unexpectedly?',
    options: [
      'I generally feel hopeful or realistic about the future.',
      'I feel a little more discouraged than usual.',
      'I often expect things to get worse or not improve.',
      'I feel very hopeless about the future.',
    ],
  },
  {
    id: 3,
    key: 'pastFailure',
    topic: 'Past failure',
    prompt: 'How much have past mistakes or setbacks been weighing on you?',
    reflectionPrompt: 'Think of one specific setback from the past year. What did it teach you, or what has made it hard to find a lesson?',
    options: [
      'Past mistakes are not weighing on me more than usual.',
      'I have been thinking about some mistakes or setbacks.',
      'I often feel defined by past mistakes or failures.',
      'I feel like I am a failure because of my past.',
    ],
  },
  {
    id: 4,
    key: 'lossOfPleasure',
    topic: 'Loss of pleasure',
    prompt: 'How much pleasure have you been getting from things you usually enjoy?',
    reflectionPrompt: 'Name one activity you used to enjoy but avoided recently. What thought or feeling stopped you from starting?',
    options: [
      'I still get usual enjoyment from activities.',
      'I enjoy things a little less than usual.',
      'I get much less pleasure from most things.',
      'I get little or no pleasure from almost anything.',
    ],
  },
  {
    id: 5,
    key: 'guilt',
    topic: 'Guilty feelings',
    prompt: 'How much guilt have you been carrying?',
    reflectionPrompt: 'Is there a situation where you believe you let someone down? Would you judge someone else as harshly in the same situation?',
    options: [
      'I do not feel unusually guilty.',
      'I feel guilty about some things.',
      'I feel guilty much of the time.',
      'I feel overwhelmed by guilt or blame.',
    ],
  },
  {
    id: 6,
    key: 'punishment',
    topic: 'Punishment feelings',
    prompt: 'Have you felt that you deserve bad things to happen to you?',
    reflectionPrompt: 'If you feel you deserve punishment, what specific action or inaction is that feeling attached to?',
    options: [
      'I do not feel that I deserve punishment.',
      'I sometimes feel I should be punished or face consequences.',
      'I often feel I deserve bad outcomes.',
      'I strongly feel I deserve punishment or suffering.',
    ],
  },
  {
    id: 7,
    key: 'selfDislike',
    topic: 'Self-dislike',
    prompt: 'How have you been feeling about yourself as a person?',
    reflectionPrompt: 'Finish the sentence: "One thing I honestly do not like about myself is..." Who would disagree, and what might they say?',
    options: [
      'I do not dislike myself more than usual.',
      'I feel disappointed in myself at times.',
      'I dislike significant things about myself.',
      'I feel strong dislike or disgust toward myself.',
    ],
  },
  {
    id: 8,
    key: 'selfCriticalness',
    topic: 'Self-criticalness',
    prompt: 'How critical have you been of yourself?',
    reflectionPrompt: 'Pick the self-criticism that stung most recently. If a friend said it about themselves, what would you reply?',
    options: [
      'I am not more self-critical than usual.',
      'I have criticised myself more than usual.',
      'I criticise myself for many things I do or do not do.',
      'I blame myself harshly for almost everything.',
    ],
  },
  {
    id: 9,
    key: 'suicidalThoughts',
    topic: 'Suicidal thoughts or wishes',
    prompt: 'Have you had thoughts that life is not worth living or that you might harm yourself?',
    reflectionPrompt: 'If this has happened and you are safe right now, what situation brought the thought on, and what helped you get through it last time?',
    options: [
      'I have not had these thoughts.',
      'I have had fleeting thoughts that life is not worth living, but no intent to harm myself.',
      'I have had thoughts of harming myself, but I would not act on them.',
      'I have had thoughts of harming myself and some intent or plan.',
    ],
  },
  {
    id: 10,
    key: 'crying',
    topic: 'Crying',
    prompt: 'How has crying changed for you recently?',
    reflectionPrompt: 'When was the last time you cried? Did it relieve anything, or did it make things feel worse?',
    options: [
      'I am not crying more than usual.',
      'I cry a little more easily than usual.',
      'I cry often or over things that would not usually affect me this much.',
      'I feel like crying frequently, or I cannot cry even when I want to.',
    ],
  },
  {
    id: 11,
    key: 'agitation',
    topic: 'Agitation',
    prompt: 'How restless, tense, or agitated have you felt?',
    reflectionPrompt: 'When you felt restless recently, were you replaying something from the past or anticipating something ahead?',
    options: [
      'I have not felt unusually restless or agitated.',
      'I have felt somewhat more restless or tense than usual.',
      'I often feel agitated or find it hard to sit still.',
      'I feel extremely agitated, driven, or unable to settle.',
    ],
  },
  {
    id: 12,
    key: 'lossOfInterest',
    topic: 'Loss of interest',
    prompt: 'How interested have you been in usual responsibilities, hobbies, or people?',
    reflectionPrompt: 'Which responsibility or hobby have you most avoided this week? What is the very first small step?',
    options: [
      'My interest is about usual.',
      'I am less interested than usual.',
      'I have lost much of my interest in many things.',
      'I have little or no interest in almost anything.',
    ],
  },
  {
    id: 13,
    key: 'indecisiveness',
    topic: 'Indecisiveness',
    prompt: 'How difficult has it been to make decisions?',
    reflectionPrompt: 'Think of one small postponed decision. What makes the options feel risky or equally bad?',
    options: [
      'I make decisions about as well as usual.',
      'I find decisions a little harder than usual.',
      'I often delay or struggle with decisions.',
      'I feel almost unable to make decisions.',
    ],
  },
  {
    id: 14,
    key: 'worthlessness',
    topic: 'Worthlessness',
    prompt: 'How worthwhile or valuable have you felt?',
    reflectionPrompt: 'Who values you, even a little? What is one small thing you contributed to someone this week?',
    options: [
      'I do not feel worthless.',
      'I feel less worthwhile than usual at times.',
      'I often feel worthless or like I do not matter.',
      'I feel completely worthless.',
    ],
  },
  {
    id: 15,
    key: 'energy',
    topic: 'Loss of energy',
    prompt: 'How has your energy level been?',
    reflectionPrompt: 'When you woke today, what was your physical energy from 1-10? What non-physical factor may be draining you?',
    options: [
      'My energy is about usual.',
      'I have less energy than usual.',
      'I often lack enough energy to do what I need.',
      'I feel almost no energy for ordinary tasks.',
    ],
  },
  {
    id: 16,
    key: 'sleep',
    topic: 'Changes in sleep pattern',
    prompt: 'How has your sleep changed?',
    reflectionPrompt: 'If sleep is shorter, what is the last thought you remember before sleep? If longer, do you wake rested or groggy?',
    options: [
      'My sleep is about usual.',
      'My sleep is slightly shorter, longer, or more disrupted than usual.',
      'My sleep is much shorter, longer, or more disrupted than usual.',
      'My sleep pattern is severely disrupted or I struggle to function because of it.',
    ],
  },
  {
    id: 17,
    key: 'irritability',
    topic: 'Irritability',
    prompt: 'How irritable have you been?',
    reflectionPrompt: 'Who or what annoyed you most recently? Did you suppress, express, or distract from the irritation?',
    options: [
      'I am not more irritable than usual.',
      'I am slightly more irritable than usual.',
      'I am often irritable or easily annoyed.',
      'I feel very irritable much of the time.',
    ],
  },
  {
    id: 18,
    key: 'appetite',
    topic: 'Changes in appetite',
    prompt: 'How has your appetite changed?',
    reflectionPrompt: 'If appetite is higher, what emotion appears before eating? If lower, what food or drink feels easiest?',
    options: [
      'My appetite is about usual.',
      'My appetite is slightly higher or lower than usual.',
      'My appetite is much higher or lower than usual.',
      'My appetite has changed severely or is affecting my functioning.',
    ],
  },
  {
    id: 19,
    key: 'concentration',
    topic: 'Concentration difficulty',
    prompt: 'How difficult has it been to concentrate?',
    reflectionPrompt: 'Pick one task from today. Was distraction mostly internal, like worry, or external, like interruptions?',
    options: [
      'I can concentrate about as well as usual.',
      'Concentration is slightly harder than usual.',
      'I often struggle to stay focused.',
      'I can barely concentrate even on simple tasks.',
    ],
  },
  {
    id: 20,
    key: 'fatigue',
    topic: 'Tiredness or fatigue',
    prompt: 'How tired or fatigued have you felt?',
    reflectionPrompt: 'Separate physical from mental fatigue. Which is stronger today, and what responsibility could be reduced for 48 hours?',
    options: [
      'I am not more tired than usual.',
      'I get tired a little more easily than usual.',
      'I am tired or fatigued much of the time.',
      'I feel too tired or fatigued to do many ordinary things.',
    ],
  },
  {
    id: 21,
    key: 'sexInterest',
    topic: 'Loss of interest in sex',
    prompt: 'Has your interest in sex changed?',
    reflectionPrompt: 'If it changed, is it better explained by energy, mood, relationship factors, medication, stress, or something else?',
    options: [
      'My interest in sex is about usual, or this item does not apply to me.',
      'My interest in sex is slightly lower than usual.',
      'My interest in sex is much lower than usual.',
      'I have almost no interest in sex compared with my usual baseline.',
    ],
  },
].map((q) => ({
  ...q,
  options: q.options.map((label, score) => ({ score, label })),
}));

function bandForScore(score) {
  if (score <= 13) {
    return {
      key: 'minimal',
      label: 'Minimal current depressive symptoms',
      range: '0-13',
      color: '#16a34a',
    };
  }
  if (score <= 19) {
    return {
      key: 'mild',
      label: 'Mild current depressive symptoms',
      range: '14-19',
      color: '#ca8a04',
    };
  }
  if (score <= 28) {
    return {
      key: 'moderate',
      label: 'Moderate current depressive symptoms',
      range: '20-28',
      color: '#ea580c',
    };
  }
  return {
    key: 'severe',
    label: 'Severe current depressive symptoms',
    range: '29-63',
    color: '#dc2626',
  };
}

function normalizeAnswers(rawAnswers) {
  if (!Array.isArray(rawAnswers)) {
    throw new Error('answers array required');
  }
  if (rawAnswers.length !== QUESTIONS.length) {
    throw new Error(`Expected ${QUESTIONS.length} answers`);
  }

  return QUESTIONS.map((question, idx) => {
    const raw = rawAnswers[idx] || {};
    if (Number(raw.questionId) !== question.id) {
      throw new Error(`Question ${idx + 1} was answered out of order`);
    }
    const score = Number(raw.score);
    const option = question.options.find((opt) => opt.score === score);
    if (!option) {
      throw new Error(`Invalid score for question ${question.id}`);
    }
    return {
      questionId: question.id,
      key: question.key,
      topic: question.topic,
      prompt: question.prompt,
      reflectionPrompt: question.reflectionPrompt,
      score,
      optionText: option.label,
      reflection: String(raw.reflection || '').trim().slice(0, 2500),
    };
  });
}

function buildAnalysis(answers, totalScore, band) {
  const topAreas = answers
    .filter((answer) => answer.score >= 2)
    .sort((a, b) => b.score - a.score || a.questionId - b.questionId)
    .slice(0, 5);
  const suicideAnswer = answers.find((answer) => answer.key === 'suicidalThoughts');
  const hasSafetyFlag = Number(suicideAnswer?.score || 0) > 0;
  const elevatedAnswers = answers.filter((answer) => answer.score >= 2);
  const severeAnswers = answers.filter((answer) => answer.score === 3);
  const reflectedAnswers = answers.filter((answer) => answer.reflection);

  const focus = topAreas.length
    ? topAreas.map((answer) => answer.topic).join(', ')
    : 'No areas were scored in the higher range.';

  const nextSteps = [];
  if (totalScore <= 13) {
    nextSteps.push('Keep using this as an occasional reflection check-in rather than a diagnosis.');
    nextSteps.push('Notice any item that rises over time, even if the total score remains low.');
  } else if (totalScore <= 19) {
    nextSteps.push('Consider repeating the check-in after a week or two and comparing the pattern.');
    nextSteps.push('Choose one high-scoring area and make one small practical change for the next 48 hours.');
  } else {
    nextSteps.push('Consider discussing these results with a trusted professional or support person.');
    nextSteps.push('Pick one stabilising action for today: sleep, food, movement, connection, or reducing one obligation.');
  }

  if (hasSafetyFlag) {
    nextSteps.unshift('Because you selected an option involving thoughts of death or self-harm, consider contacting local crisis support, emergency services, or a trusted person now if there is any current risk.');
  }

  const signalSummary = topAreas.length
    ? `The impression was formed by adding the 21 item scores, then looking at the highest-scoring themes. ${elevatedAnswers.length} item${elevatedAnswers.length === 1 ? '' : 's'} were in the stronger signal range (2 or 3), including ${topAreas.map((answer) => `${answer.topic} (${answer.score}/3)`).join(', ')}.`
    : 'The impression was formed by adding the 21 item scores. No item was scored at 2 or 3, so the result is mainly a low overall pattern rather than one dominant concern.';

  return {
    summary: `Your total score is ${totalScore}/63, which falls in the "${band.label}" range for this proof-of-concept wellbeing self-check.`,
    interpretation: `The strongest current signals are: ${focus}. This is not a diagnosis; it is a structured reflection of how you answered today.`,
    rationale: {
      scoring: `Each question is scored from 0 to 3, so the total score is the sum of the intensity selected across all 21 questions. Your total of ${totalScore}/63 falls in the ${band.range} range (${band.label}).`,
      pattern: signalSummary,
      elevatedCount: elevatedAnswers.length,
      severeCount: severeAnswers.length,
      reflectionCount: reflectedAnswers.length,
      drivers: topAreas.map((answer) => ({
        questionId: answer.questionId,
        topic: answer.topic,
        prompt: answer.prompt,
        score: answer.score,
        selectedOption: answer.optionText,
        reflection: answer.reflection,
        reason: `${answer.topic} shaped the impression because it was answered at ${answer.score}/3: "${answer.optionText}".${answer.reflection ? ' Your reflection added extra context for this signal.' : ''}`,
      })),
    },
    topAreas,
    nextSteps,
    safetyFlag: hasSafetyFlag,
    disclaimer: 'This proof of concept is for personal reflection only. It is not a medical, psychological, or diagnostic assessment.',
  };
}

router.get('/questions', (_req, res) => {
  res.json({
    version: QUESTIONNAIRE_VERSION,
    title: 'Wellbeing Check',
    disclaimer: 'A proof-of-concept reflection tool. Not medical advice or a diagnostic assessment.',
    questions: QUESTIONS,
    bands: [
      { range: '0-13', label: 'Minimal current depressive symptoms' },
      { range: '14-19', label: 'Mild current depressive symptoms' },
      { range: '20-28', label: 'Moderate current depressive symptoms' },
      { range: '29-63', label: 'Severe current depressive symptoms' },
    ],
  });
});

router.get('/panas/questions', (_req, res) => {
  res.json({
    version: PANAS_QUESTIONNAIRE_VERSION,
    title: 'PANAS-Style Affect Check',
    disclaimer: 'A proof-of-concept affect snapshot using original PANAS-style wording. Not the official PANAS, diagnosis, or professional advice.',
    questions: PANAS_QUESTIONS,
    scales: PANAS_SCALES.map(({ key, label, family, description }) => ({ key, label, family, description })),
    responseOptions: PANAS_QUESTIONS[0]?.options || [],
  });
});

router.get('/asrs5/questions', (_req, res) => {
  res.json({
    version: ASRS5_QUESTIONNAIRE_VERSION,
    title: 'ASRS-5-Style Attention Check',
    disclaimer: 'A proof-of-concept adult attention/self-regulation screener using original ASRS-5-style wording. Not the official ASRS-5, diagnosis, or professional advice.',
    questions: ASRS5_QUESTIONS,
    scales: ASRS5_SCALES.map(({ key, label, family, description }) => ({ key, label, family, description })),
    responseOptions: ASRS5_QUESTIONS[0]?.options || [],
  });
});

router.get('/gad7/questions', (_req, res) => {
  res.json({
    version: GAD7_QUESTIONNAIRE_VERSION,
    title: 'GAD-7-Style Anxiety Check',
    disclaimer: 'A proof-of-concept anxiety screener using original GAD-7-style wording. Not the official GAD-7, diagnosis, or professional advice.',
    questions: GAD7_QUESTIONS,
    responseOptions: GAD7_QUESTIONS[0]?.options || [],
    bands: [
      { range: '0-4', label: 'Minimal anxiety range' },
      { range: '5-9', label: 'Mild anxiety range' },
      { range: '10-14', label: 'Moderate anxiety range' },
      { range: '15-21', label: 'Severe anxiety range' },
    ],
  });
});

router.get('/ipip/questions', (_req, res) => {
  res.json({
    version: IPIP_QUESTIONNAIRE_VERSION,
    title: 'IPIP-NEO-120 Personality Inventory',
    disclaimer: 'A proof-of-concept self-report personality profile inspired by the public-domain IPIP-NEO-120. Not professional advice or a substitute for a qualified professional.',
    questions: IPIP_QUESTIONS,
    facets: IPIP_FACETS.map(({ code, domain, label }) => ({ code, domain, label })),
    domains: Object.values(IPIP_DOMAINS),
  });
});

router.get('/cerq/questions', (_req, res) => {
  res.json({
    version: CERQ_QUESTIONNAIRE_VERSION,
    title: 'CERQ-Style Cognitive Coping Check',
    disclaimer: 'A proof-of-concept cognitive coping profile inspired by CERQ strategy areas, using original item wording. Not the official CERQ, professional advice, or a substitute for a qualified professional.',
    questions: CERQ_QUESTIONS,
    scales: CERQ_SCALES.map(({ key, label, family, description }) => ({ key, label, family, description })),
  });
});

router.get('/cope/questions', (_req, res) => {
  res.json({
    version: COPE_QUESTIONNAIRE_VERSION,
    title: 'Brief COPE-Style Coping Check',
    disclaimer: 'A proof-of-concept coping profile inspired by Brief COPE scale areas, using original item wording. Not professional advice or a substitute for a qualified professional.',
    questions: COPE_QUESTIONS,
    scales: COPE_SCALES.map(({ key, label, family, description }) => ({ key, label, family, description })),
  });
});

router.get('/panas/attempts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "questionnaireVersion", "scaleScores", analysis, "createdAt"
       FROM panas_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/panas/attempts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM panas_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = rows[0];
    attempt.analysis = parseMaybeJson(attempt.analysis, {});
    attempt.answers = parseMaybeJson(attempt.answers, []);
    attempt.scaleScores = parseMaybeJson(attempt.scaleScores, []);
    if (!attempt.analysis.modelInsight || attempt.analysis.modelInsight.formatVersion !== 2) {
      attempt.analysis.modelInsight = await generateModelInsight(req.user.id, {
        title: 'PANAS-Style Affect Check',
        purpose: 'Interpret a 20-item proof-of-concept affect snapshot across positive affect and negative affect. Focus on current emotional tone, not diagnosis or stable personality.',
        scores: { scaleScores: attempt.scaleScores, answers: attempt.answers },
        existingAnalysis: attempt.analysis,
        scoreLines: latestScoreLinesFromScales(attempt.scaleScores, 2),
      });
      await pool.query('UPDATE panas_attempts SET analysis=$1 WHERE id=$2 AND "userId"=$3', [JSON.stringify(attempt.analysis), req.params.id, req.user.id]);
    }
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/panas/attempts/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM panas_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });

    const buf = await buildPanasPdfBuffer({ attempt: rows[0] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="panas-style-${req.params.id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[panas pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/panas/attempts', async (req, res) => {
  try {
    const answers = normalizePanasAnswers(req.body?.answers);
    const { scaleScores, analysis } = scorePanasAnswers(answers);
    analysis.modelInsight = await generateModelInsight(req.user.id, {
      title: 'PANAS-Style Affect Check',
      purpose: 'Interpret a 20-item proof-of-concept affect snapshot across positive affect and negative affect. Focus on current emotional tone, not diagnosis or stable personality.',
      scores: { scaleScores, answers },
      existingAnalysis: analysis,
      scoreLines: latestScoreLinesFromScales(scaleScores, 2),
    });

    const { rows } = await pool.query(
      `INSERT INTO panas_attempts (
         "userId", "questionnaireVersion", answers, "scaleScores", analysis
       )
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        req.user.id,
        PANAS_QUESTIONNAIRE_VERSION,
        JSON.stringify(answers),
        JSON.stringify(scaleScores),
        JSON.stringify(analysis),
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    const status = /required|Expected|Invalid|out of order/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/panas/attempts/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM panas_attempts WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/asrs5/attempts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "questionnaireVersion", "totalScore", band, "bandLabel", "scaleScores", analysis, "createdAt"
       FROM asrs5_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/asrs5/attempts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM asrs5_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = rows[0];
    attempt.analysis = parseMaybeJson(attempt.analysis, {});
    attempt.answers = parseMaybeJson(attempt.answers, []);
    attempt.scaleScores = parseMaybeJson(attempt.scaleScores, []);
    if (!attempt.analysis.modelInsight || attempt.analysis.modelInsight.formatVersion !== 2) {
      attempt.analysis.modelInsight = await generateModelInsight(req.user.id, {
        title: 'ASRS-5-Style Attention Check',
        purpose: 'Interpret a six-item proof-of-concept adult attention/self-regulation screener. Focus on attention, activation, impulsivity, planning, and external structure patterns; do not diagnose ADHD.',
        scores: { totalScore: attempt.totalScore, bandLabel: attempt.bandLabel, scaleScores: attempt.scaleScores, answers: attempt.answers },
        existingAnalysis: attempt.analysis,
        scoreLines: latestScoreLinesFromScales(attempt.scaleScores, 6),
      });
      await pool.query('UPDATE asrs5_attempts SET analysis=$1 WHERE id=$2 AND "userId"=$3', [JSON.stringify(attempt.analysis), req.params.id, req.user.id]);
    }
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/asrs5/attempts/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM asrs5_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });

    const buf = await buildAsrs5PdfBuffer({ attempt: rows[0] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="asrs-5-style-${req.params.id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[asrs5 pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/asrs5/attempts', async (req, res) => {
  try {
    const answers = normalizeAsrs5Answers(req.body?.answers);
    const { totalScore, band, scaleScores, analysis } = scoreAsrs5Answers(answers);
    analysis.modelInsight = await generateModelInsight(req.user.id, {
      title: 'ASRS-5-Style Attention Check',
      purpose: 'Interpret a six-item proof-of-concept adult attention/self-regulation screener. Focus on attention, activation, impulsivity, planning, and external structure patterns; do not diagnose ADHD.',
      scores: { totalScore, bandLabel: band.label, scaleScores, answers },
      existingAnalysis: analysis,
      scoreLines: latestScoreLinesFromScales(scaleScores, 6),
    });

    const { rows } = await pool.query(
      `INSERT INTO asrs5_attempts (
         "userId", "questionnaireVersion", answers, "totalScore", band, "bandLabel", "scaleScores", analysis
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.user.id,
        ASRS5_QUESTIONNAIRE_VERSION,
        JSON.stringify(answers),
        totalScore,
        band.key,
        band.label,
        JSON.stringify(scaleScores),
        JSON.stringify(analysis),
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    const status = /required|Expected|Invalid|out of order/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/asrs5/attempts/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM asrs5_attempts WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/gad7/attempts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "questionnaireVersion", "totalScore", band, "bandLabel", analysis, "createdAt"
       FROM gad7_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/gad7/attempts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM gad7_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = rows[0];
    attempt.analysis = parseMaybeJson(attempt.analysis, {});
    attempt.answers = parseMaybeJson(attempt.answers, []);
    if (!attempt.analysis.modelInsight || attempt.analysis.modelInsight.formatVersion !== 2) {
      attempt.analysis.modelInsight = await generateModelInsight(req.user.id, {
        title: 'GAD-7-Style Anxiety Check',
        purpose: 'Interpret a seven-item proof-of-concept anxiety screener. Focus on anxiety-domain patterns and current worry/tension load; do not diagnose.',
        scores: { totalScore: attempt.totalScore, bandLabel: attempt.bandLabel, answers: attempt.answers },
        existingAnalysis: attempt.analysis,
        scoreLines: attempt.answers.map((answer) => `${answer.topic}: ${answer.score}/3 (${answer.optionText})`),
      });
      await pool.query('UPDATE gad7_attempts SET analysis=$1 WHERE id=$2 AND "userId"=$3', [JSON.stringify(attempt.analysis), req.params.id, req.user.id]);
    }
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/gad7/attempts/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM gad7_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });

    const buf = await buildGad7PdfBuffer({ attempt: rows[0] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="gad-7-style-${req.params.id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[gad7 pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/gad7/attempts', async (req, res) => {
  try {
    const answers = normalizeGad7Answers(req.body?.answers);
    const { totalScore, band, analysis } = scoreGad7Answers(answers);
    analysis.modelInsight = await generateModelInsight(req.user.id, {
      title: 'GAD-7-Style Anxiety Check',
      purpose: 'Interpret a seven-item proof-of-concept anxiety screener. Focus on anxiety-domain patterns and current worry/tension load; do not diagnose.',
      scores: { totalScore, bandLabel: band.label, answers },
      existingAnalysis: analysis,
      scoreLines: answers.map((answer) => `${answer.topic}: ${answer.score}/3 (${answer.optionText})`),
    });

    const { rows } = await pool.query(
      `INSERT INTO gad7_attempts (
         "userId", "questionnaireVersion", answers, "totalScore", band, "bandLabel", analysis
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        req.user.id,
        GAD7_QUESTIONNAIRE_VERSION,
        JSON.stringify(answers),
        totalScore,
        band.key,
        band.label,
        JSON.stringify(analysis),
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    const status = /required|Expected|Invalid|out of order/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/gad7/attempts/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM gad7_attempts WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cope/attempts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "questionnaireVersion", "scaleScores", analysis, "createdAt"
       FROM cope_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cope/attempts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM cope_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = rows[0];
    attempt.analysis = parseMaybeJson(attempt.analysis, {});
    attempt.answers = parseMaybeJson(attempt.answers, []);
    attempt.scaleScores = parseMaybeJson(attempt.scaleScores, []);
    if (!attempt.analysis.modelInsight || attempt.analysis.modelInsight.formatVersion !== 2) {
      attempt.analysis.modelInsight = await generateModelInsight(req.user.id, {
        title: 'Brief COPE-Style Coping Check',
        purpose: 'Interpret a 28-item proof-of-concept coping profile inspired by Brief COPE scale areas. There is no overall total score; interpret the coping strategy pattern.',
        scores: { scaleScores: attempt.scaleScores, answers: attempt.answers },
        existingAnalysis: attempt.analysis,
        scoreLines: latestScoreLinesFromScales(attempt.scaleScores, 8),
      });
      await pool.query('UPDATE cope_attempts SET analysis=$1 WHERE id=$2 AND "userId"=$3', [JSON.stringify(attempt.analysis), req.params.id, req.user.id]);
    }
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cope/attempts/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM cope_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });

    const buf = await buildCopePdfBuffer({ attempt: rows[0] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="brief-cope-style-${req.params.id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[brief cope pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/cope/attempts', async (req, res) => {
  try {
    const answers = normalizeCopeAnswers(req.body?.answers);
    const { scaleScores, analysis } = scoreCopeAnswers(answers);
    analysis.modelInsight = await generateModelInsight(req.user.id, {
      title: 'Brief COPE-Style Coping Check',
      purpose: 'Interpret a 28-item proof-of-concept coping profile inspired by Brief COPE scale areas. There is no overall total score; interpret the coping strategy pattern.',
      scores: { scaleScores, answers },
      existingAnalysis: analysis,
      scoreLines: latestScoreLinesFromScales(scaleScores, 8),
    });

    const { rows } = await pool.query(
      `INSERT INTO cope_attempts (
         "userId", "questionnaireVersion", answers, "scaleScores", analysis
       )
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        req.user.id,
        COPE_QUESTIONNAIRE_VERSION,
        JSON.stringify(answers),
        JSON.stringify(scaleScores),
        JSON.stringify(analysis),
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    const status = /required|Expected|Invalid|out of order/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/cope/attempts/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM cope_attempts WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cerq/attempts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "questionnaireVersion", "scaleScores", analysis, "createdAt"
       FROM cerq_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cerq/attempts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM cerq_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = rows[0];
    attempt.analysis = parseMaybeJson(attempt.analysis, {});
    attempt.answers = parseMaybeJson(attempt.answers, []);
    attempt.scaleScores = parseMaybeJson(attempt.scaleScores, []);
    if (!attempt.analysis.modelInsight || attempt.analysis.modelInsight.formatVersion !== 2) {
      attempt.analysis.modelInsight = await generateModelInsight(req.user.id, {
        title: 'CERQ-Style Cognitive Coping Check',
        purpose: 'Interpret a 36-item proof-of-concept profile of cognitive emotion-regulation strategy use after stress.',
        scores: { scaleScores: attempt.scaleScores, answers: attempt.answers },
        existingAnalysis: attempt.analysis,
        scoreLines: latestScoreLinesFromScales(attempt.scaleScores, 8),
      });
      await pool.query('UPDATE cerq_attempts SET analysis=$1 WHERE id=$2 AND "userId"=$3', [JSON.stringify(attempt.analysis), req.params.id, req.user.id]);
    }
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cerq/attempts/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM cerq_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });

    const buf = await buildCerqPdfBuffer({ attempt: rows[0] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cerq-style-${req.params.id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[cerq pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/cerq/attempts', async (req, res) => {
  try {
    const answers = normalizeCerqAnswers(req.body?.answers);
    const { scaleScores, analysis } = scoreCerqAnswers(answers);
    analysis.modelInsight = await generateModelInsight(req.user.id, {
      title: 'CERQ-Style Cognitive Coping Check',
      purpose: 'Interpret a 36-item proof-of-concept profile of cognitive emotion-regulation strategy use after stress.',
      scores: { scaleScores, answers },
      existingAnalysis: analysis,
      scoreLines: latestScoreLinesFromScales(scaleScores, 8),
    });

    const { rows } = await pool.query(
      `INSERT INTO cerq_attempts (
         "userId", "questionnaireVersion", answers, "scaleScores", analysis
       )
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        req.user.id,
        CERQ_QUESTIONNAIRE_VERSION,
        JSON.stringify(answers),
        JSON.stringify(scaleScores),
        JSON.stringify(analysis),
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    const status = /required|Expected|Invalid|out of order/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/cerq/attempts/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM cerq_attempts WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ipip/attempts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "questionnaireVersion", "domainScores", analysis, "createdAt"
       FROM ipip_neo_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ipip/attempts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM ipip_neo_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = rows[0];
    attempt.analysis = parseMaybeJson(attempt.analysis, {});
    attempt.answers = parseMaybeJson(attempt.answers, []);
    attempt.facetScores = parseMaybeJson(attempt.facetScores, []);
    attempt.domainScores = parseMaybeJson(attempt.domainScores, []);
    if (!attempt.analysis.modelInsight || attempt.analysis.modelInsight.formatVersion !== 2) {
      attempt.analysis.modelInsight = await generateModelInsight(req.user.id, {
        title: 'IPIP-NEO-120 Personality Inventory',
        purpose: 'Interpret a proof-of-concept personality profile across five broad domains and 30 facets. Focus on trait patterns and tensions, not diagnosis or capability judgement.',
        scores: { domainScores: attempt.domainScores, facetScores: attempt.facetScores, answers: attempt.answers.slice(0, 20) },
        existingAnalysis: attempt.analysis,
        scoreLines: [
          ...latestScoreLinesFromScales(attempt.domainScores, 5),
          ...latestScoreLinesFromScales(attempt.facetScores, 8),
        ],
      });
      await pool.query('UPDATE ipip_neo_attempts SET analysis=$1 WHERE id=$2 AND "userId"=$3', [JSON.stringify(attempt.analysis), req.params.id, req.user.id]);
    }
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ipip/attempts/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM ipip_neo_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });

    const buf = await buildIpipNeoPdfBuffer({ attempt: rows[0] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ipip-neo-120-${req.params.id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[ipip neo pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/ipip/attempts', async (req, res) => {
  try {
    const answers = normalizeIpipAnswers(req.body?.answers);
    const { facetScores, domainScores, analysis } = scoreIpipAnswers(answers);
    analysis.modelInsight = await generateModelInsight(req.user.id, {
      title: 'IPIP-NEO-120 Personality Inventory',
      purpose: 'Interpret a proof-of-concept personality profile across five broad domains and 30 facets. Focus on trait patterns and tensions, not diagnosis or capability judgement.',
      scores: { domainScores, facetScores, answers: answers.slice(0, 20) },
      existingAnalysis: analysis,
      scoreLines: [
        ...latestScoreLinesFromScales(domainScores, 5),
        ...latestScoreLinesFromScales(facetScores, 8),
      ],
    });

    const { rows } = await pool.query(
      `INSERT INTO ipip_neo_attempts (
         "userId", "questionnaireVersion", answers, "facetScores", "domainScores", analysis
       )
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        req.user.id,
        IPIP_QUESTIONNAIRE_VERSION,
        JSON.stringify(answers),
        JSON.stringify(facetScores),
        JSON.stringify(domainScores),
        JSON.stringify(analysis),
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    const status = /required|Expected|Invalid|out of order/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/ipip/attempts/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM ipip_neo_attempts WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/hexaco/questions', (_req, res) => {
  res.json({
    version: HEXACO_QUESTIONNAIRE_VERSION,
    name: 'HEXACO-60-Style Personality Check',
    description: 'A proof-of-concept 60-item personality self-report across six HEXACO-style domains.',
    responseOptions: HEXACO_QUESTIONS[0]?.options || [],
    domains: Object.values(HEXACO_DOMAINS),
    questions: HEXACO_QUESTIONS,
  });
});

router.get('/hexaco/attempts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "questionnaireVersion", "domainScores", analysis, "createdAt"
       FROM hexaco_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/hexaco/attempts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM hexaco_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = rows[0];
    attempt.analysis = parseMaybeJson(attempt.analysis, {});
    attempt.answers = parseMaybeJson(attempt.answers, []);
    attempt.domainScores = parseMaybeJson(attempt.domainScores, []);
    if (!attempt.analysis.modelInsight || attempt.analysis.modelInsight.formatVersion !== 2) {
      attempt.analysis.modelInsight = await generateModelInsight(req.user.id, {
        title: 'HEXACO-60-Style Personality Check',
        purpose: 'Interpret a proof-of-concept personality profile across six HEXACO-style domains. Focus on trait patterns, relational style, and tensions; avoid diagnosis, suitability judgement, or certainty.',
        scores: { domainScores: attempt.domainScores, answers: attempt.answers.slice(0, 20) },
        existingAnalysis: attempt.analysis,
        scoreLines: latestScoreLinesFromScales(attempt.domainScores, 6),
      });
      await pool.query('UPDATE hexaco_attempts SET analysis=$1 WHERE id=$2 AND "userId"=$3', [JSON.stringify(attempt.analysis), req.params.id, req.user.id]);
    }
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/hexaco/attempts/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM hexaco_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });

    const buf = await buildHexacoPdfBuffer({ attempt: rows[0] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="hexaco-60-style-${req.params.id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[hexaco pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/hexaco/attempts', async (req, res) => {
  try {
    const answers = normalizeHexacoAnswers(req.body?.answers);
    const { domainScores, analysis } = scoreHexacoAnswers(answers);
    analysis.modelInsight = await generateModelInsight(req.user.id, {
      title: 'HEXACO-60-Style Personality Check',
      purpose: 'Interpret a proof-of-concept personality profile across six HEXACO-style domains. Focus on trait patterns, relational style, and tensions; avoid diagnosis, suitability judgement, or certainty.',
      scores: { domainScores, answers: answers.slice(0, 20) },
      existingAnalysis: analysis,
      scoreLines: latestScoreLinesFromScales(domainScores, 6),
    });

    const { rows } = await pool.query(
      `INSERT INTO hexaco_attempts (
         "userId", "questionnaireVersion", answers, "domainScores", analysis
       )
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        req.user.id,
        HEXACO_QUESTIONNAIRE_VERSION,
        JSON.stringify(answers),
        JSON.stringify(domainScores),
        JSON.stringify(analysis),
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    const status = /required|Expected|Invalid|out of order/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/hexaco/attempts/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM hexaco_attempts WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function loadLatestProfileInputs(userId) {
  const [mood, gad7, panas, asrs5, ipip, hexaco, cerq, cope] = await Promise.all([
    pool.query(
      `SELECT *
       FROM wellbeing_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query(
      `SELECT *
       FROM gad7_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query(
      `SELECT *
       FROM panas_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query(
      `SELECT *
       FROM asrs5_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query(
      `SELECT *
       FROM ipip_neo_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query(
      `SELECT *
       FROM hexaco_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query(
      `SELECT *
       FROM cerq_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query(
      `SELECT *
       FROM cope_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId]
    ),
  ]);

  const latest = {
    mood: mood.rows[0] || null,
    gad7: gad7.rows[0] || null,
    panas: panas.rows[0] || null,
    asrs5: asrs5.rows[0] || null,
    ipip: ipip.rows[0] || null,
    hexaco: hexaco.rows[0] || null,
    cerq: cerq.rows[0] || null,
    cope: cope.rows[0] || null,
  };

  if (latest.mood) {
    latest.mood.analysis = parseMaybeJson(latest.mood.analysis, {});
    latest.mood.answers = parseMaybeJson(latest.mood.answers, []);
  }
  if (latest.gad7) {
    latest.gad7.analysis = parseMaybeJson(latest.gad7.analysis, {});
    latest.gad7.answers = parseMaybeJson(latest.gad7.answers, []);
  }
  if (latest.panas) {
    latest.panas.analysis = parseMaybeJson(latest.panas.analysis, {});
    latest.panas.answers = parseMaybeJson(latest.panas.answers, []);
    latest.panas.scaleScores = parseMaybeJson(latest.panas.scaleScores, []);
  }
  if (latest.asrs5) {
    latest.asrs5.analysis = parseMaybeJson(latest.asrs5.analysis, {});
    latest.asrs5.answers = parseMaybeJson(latest.asrs5.answers, []);
    latest.asrs5.scaleScores = parseMaybeJson(latest.asrs5.scaleScores, []);
  }
  if (latest.ipip) {
    latest.ipip.analysis = parseMaybeJson(latest.ipip.analysis, {});
    latest.ipip.answers = parseMaybeJson(latest.ipip.answers, []);
    latest.ipip.facetScores = parseMaybeJson(latest.ipip.facetScores, []);
    latest.ipip.domainScores = parseMaybeJson(latest.ipip.domainScores, []);
  }
  if (latest.hexaco) {
    latest.hexaco.analysis = parseMaybeJson(latest.hexaco.analysis, {});
    latest.hexaco.answers = parseMaybeJson(latest.hexaco.answers, []);
    latest.hexaco.domainScores = parseMaybeJson(latest.hexaco.domainScores, []);
  }
  if (latest.cerq) {
    latest.cerq.analysis = parseMaybeJson(latest.cerq.analysis, {});
    latest.cerq.answers = parseMaybeJson(latest.cerq.answers, []);
    latest.cerq.scaleScores = parseMaybeJson(latest.cerq.scaleScores, []);
  }
  if (latest.cope) {
    latest.cope.analysis = parseMaybeJson(latest.cope.analysis, {});
    latest.cope.answers = parseMaybeJson(latest.cope.answers, []);
    latest.cope.scaleScores = parseMaybeJson(latest.cope.scaleScores, []);
  }

  return latest;
}

function profileStatusFromLatest(latest) {
  const tests = [
    { key: 'mood', label: 'BDI-Style Mood Check', completed: !!latest.mood, completedAt: latest.mood?.createdAt || null },
    { key: 'gad7', label: 'GAD-7-Style Anxiety Check', completed: !!latest.gad7, completedAt: latest.gad7?.createdAt || null },
    { key: 'panas', label: 'PANAS-Style Affect Check', completed: !!latest.panas, completedAt: latest.panas?.createdAt || null },
    { key: 'asrs5', label: 'ASRS-5-Style Attention Check', completed: !!latest.asrs5, completedAt: latest.asrs5?.createdAt || null },
    { key: 'ipip', label: 'IPIP-NEO-120 Personality Inventory', completed: !!latest.ipip, completedAt: latest.ipip?.createdAt || null },
    { key: 'hexaco', label: 'HEXACO-60-Style Personality Check', completed: !!latest.hexaco, completedAt: latest.hexaco?.createdAt || null },
    { key: 'cerq', label: 'CERQ-Style Cognitive Coping Check', completed: !!latest.cerq, completedAt: latest.cerq?.createdAt || null },
    { key: 'cope', label: 'Brief COPE-Style Coping Check', completed: !!latest.cope, completedAt: latest.cope?.createdAt || null },
  ];
  return {
    available: tests.every((test) => test.completed),
    tests,
    missing: tests.filter((test) => !test.completed).map((test) => test.key),
  };
}

function moduleStatusFromLatest(latest) {
  return WELLBEING_MODULES.map((module) => {
    const tests = module.tests.map((key) => ({
      key,
      completed: !!latest[key],
      completedAt: latest[key]?.createdAt || null,
    }));
    return {
      key: module.key,
      label: module.label,
      shortLabel: module.shortLabel,
      description: module.description,
      tests: module.tests,
      testLabels: module.testLabels,
      completed: tests.every((test) => test.completed),
      completedAt: tests
        .map((test) => test.completedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
      missing: tests.filter((test) => !test.completed).map((test) => test.key),
    };
  });
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function demoInsight(title) {
  return {
    formatVersion: 2,
    summary: `Admin-generated sample data for ${title}.`,
    sections: [
      {
        title: 'Demo data notice',
        body: 'These responses were generated randomly by an administrator to test the wellbeing dashboard, chart, mind-map, and combined-profile flows. They should not be interpreted as a real self-report result.',
      },
    ],
    reflectionQuestions: [],
    caveats: ['Generated random demo data only. Not a real wellbeing or personality assessment.'],
  };
}

function randomMoodRawAnswers() {
  return QUESTIONS.map((question) => ({
    questionId: question.id,
    score: question.key === 'suicidalThoughts' ? 0 : randomInt(0, 3),
    reflection: '',
  }));
}

function randomValueRawAnswers(questions, responseMax, idKey = 'questionId') {
  return questions.map((question) => ({
    [idKey]: question.id,
    value: randomInt(1, responseMax),
  }));
}

async function insertRandomMoodAttempt(client, userId) {
  const answers = normalizeAnswers(randomMoodRawAnswers());
  const totalScore = answers.reduce((sum, answer) => sum + answer.score, 0);
  const band = bandForScore(totalScore);
  const analysis = buildAnalysis(answers, totalScore, band);
  const safetyAnswer = answers.find((answer) => answer.key === 'suicidalThoughts');
  analysis.generated = true;
  analysis.modelInsight = demoInsight('BDI-Style Mood Check');

  const { rows } = await client.query(
    `INSERT INTO wellbeing_attempts (
       "userId", "questionnaireVersion", answers, "totalScore", band, "bandLabel",
       analysis, "safetyFlag", "suicidalThoughtScore"
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, "createdAt"`,
    [
      userId,
      QUESTIONNAIRE_VERSION,
      JSON.stringify(answers),
      totalScore,
      band.key,
      band.label,
      JSON.stringify(analysis),
      analysis.safetyFlag,
      Number(safetyAnswer?.score || 0),
    ]
  );
  return { ...rows[0], totalScore, bandLabel: band.label };
}

async function insertRandomGad7Attempt(client, userId) {
  const answers = normalizeGad7Answers(GAD7_QUESTIONS.map((question) => ({
    questionId: question.id,
    score: randomInt(0, 3),
  })));
  const { totalScore, band, analysis } = scoreGad7Answers(answers);
  analysis.generated = true;
  analysis.modelInsight = demoInsight('GAD-7-Style Anxiety Check');

  const { rows } = await client.query(
    `INSERT INTO gad7_attempts (
       "userId", "questionnaireVersion", answers, "totalScore", band, "bandLabel", analysis
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, "createdAt"`,
    [
      userId,
      GAD7_QUESTIONNAIRE_VERSION,
      JSON.stringify(answers),
      totalScore,
      band.key,
      band.label,
      JSON.stringify(analysis),
    ]
  );
  return rows[0];
}

async function insertRandomIpipAttempt(client, userId) {
  const answers = normalizeIpipAnswers(randomValueRawAnswers(IPIP_QUESTIONS, 5, 'itemId'));
  const { facetScores, domainScores, analysis } = scoreIpipAnswers(answers);
  analysis.generated = true;
  analysis.modelInsight = demoInsight('IPIP-NEO-120 Personality Inventory');

  const { rows } = await client.query(
    `INSERT INTO ipip_neo_attempts (
       "userId", "questionnaireVersion", answers, "facetScores", "domainScores", analysis
     )
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, "createdAt"`,
    [
      userId,
      IPIP_QUESTIONNAIRE_VERSION,
      JSON.stringify(answers),
      JSON.stringify(facetScores),
      JSON.stringify(domainScores),
      JSON.stringify(analysis),
    ]
  );
  return rows[0];
}

async function insertRandomPanasAttempt(client, userId) {
  const answers = normalizePanasAnswers(randomValueRawAnswers(PANAS_QUESTIONS, 5));
  const { scaleScores, analysis } = scorePanasAnswers(answers);
  analysis.generated = true;
  analysis.modelInsight = demoInsight('PANAS-Style Affect Check');

  const { rows } = await client.query(
    `INSERT INTO panas_attempts (
       "userId", "questionnaireVersion", answers, "scaleScores", analysis
     )
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, "createdAt"`,
    [
      userId,
      PANAS_QUESTIONNAIRE_VERSION,
      JSON.stringify(answers),
      JSON.stringify(scaleScores),
      JSON.stringify(analysis),
    ]
  );
  return rows[0];
}

async function insertRandomAsrs5Attempt(client, userId) {
  const answers = normalizeAsrs5Answers(randomValueRawAnswers(ASRS5_QUESTIONS, 4));
  const { totalScore, band, scaleScores, analysis } = scoreAsrs5Answers(answers);
  analysis.generated = true;
  analysis.modelInsight = demoInsight('ASRS-5-Style Attention Check');

  const { rows } = await client.query(
    `INSERT INTO asrs5_attempts (
       "userId", "questionnaireVersion", answers, "totalScore", band, "bandLabel", "scaleScores", analysis
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, "createdAt"`,
    [
      userId,
      ASRS5_QUESTIONNAIRE_VERSION,
      JSON.stringify(answers),
      totalScore,
      band.key,
      band.label,
      JSON.stringify(scaleScores),
      JSON.stringify(analysis),
    ]
  );
  return rows[0];
}

async function insertRandomHexacoAttempt(client, userId) {
  const answers = normalizeHexacoAnswers(randomValueRawAnswers(HEXACO_QUESTIONS, 5, 'itemId'));
  const { domainScores, analysis } = scoreHexacoAnswers(answers);
  analysis.generated = true;
  analysis.modelInsight = demoInsight('HEXACO-60-Style Personality Check');

  const { rows } = await client.query(
    `INSERT INTO hexaco_attempts (
       "userId", "questionnaireVersion", answers, "domainScores", analysis
     )
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, "createdAt"`,
    [
      userId,
      HEXACO_QUESTIONNAIRE_VERSION,
      JSON.stringify(answers),
      JSON.stringify(domainScores),
      JSON.stringify(analysis),
    ]
  );
  return rows[0];
}

async function insertRandomCerqAttempt(client, userId) {
  const answers = normalizeCerqAnswers(randomValueRawAnswers(CERQ_QUESTIONS, 5));
  const { scaleScores, analysis } = scoreCerqAnswers(answers);
  analysis.generated = true;
  analysis.modelInsight = demoInsight('CERQ-Style Cognitive Coping Check');

  const { rows } = await client.query(
    `INSERT INTO cerq_attempts (
       "userId", "questionnaireVersion", answers, "scaleScores", analysis
     )
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, "createdAt"`,
    [
      userId,
      CERQ_QUESTIONNAIRE_VERSION,
      JSON.stringify(answers),
      JSON.stringify(scaleScores),
      JSON.stringify(analysis),
    ]
  );
  return rows[0];
}

async function insertRandomCopeAttempt(client, userId) {
  const answers = normalizeCopeAnswers(randomValueRawAnswers(COPE_QUESTIONS, 4));
  const { scaleScores, analysis } = scoreCopeAnswers(answers);
  analysis.generated = true;
  analysis.modelInsight = demoInsight('Brief COPE-Style Coping Check');

  const { rows } = await client.query(
    `INSERT INTO cope_attempts (
       "userId", "questionnaireVersion", answers, "scaleScores", analysis
     )
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, "createdAt"`,
    [
      userId,
      COPE_QUESTIONNAIRE_VERSION,
      JSON.stringify(answers),
      JSON.stringify(scaleScores),
      JSON.stringify(analysis),
    ]
  );
  return rows[0];
}

async function loadWellbeingInviteTemplate() {
  const { rows } = await pool.query(
    'SELECT key, value FROM workspace_settings WHERE key = ANY($1)',
    [[WELLBEING_INVITE_SUBJECT_KEY, WELLBEING_INVITE_BODY_KEY]]
  );
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    subject: values[WELLBEING_INVITE_SUBJECT_KEY] || DEFAULT_WELLBEING_INVITE_SUBJECT,
    body: values[WELLBEING_INVITE_BODY_KEY] || DEFAULT_WELLBEING_INVITE_BODY,
  };
}

function visualProfileFromLatest(latest, keys = ['mood', 'gad7', 'panas', 'asrs5', 'ipip', 'hexaco', 'cerq', 'cope']) {
  const include = (key) => keys.includes(key) && latest[key];
  return {
    sourceAttempts: sourceAttemptsForKeys(latest, keys),
    ...(include('mood') ? { mood: {
      totalScore: latest.mood.totalScore,
      band: latest.mood.band,
      bandLabel: latest.mood.bandLabel,
      safetyFlag: latest.mood.safetyFlag,
      createdAt: latest.mood.createdAt,
    } } : {}),
    ...(include('gad7') ? { gad7: {
      totalScore: latest.gad7.totalScore,
      band: latest.gad7.band,
      bandLabel: latest.gad7.bandLabel,
      createdAt: latest.gad7.createdAt,
    } } : {}),
    ...(include('panas') ? { panas: {
      scaleScores: latest.panas.scaleScores,
      createdAt: latest.panas.createdAt,
    } } : {}),
    ...(include('asrs5') ? { asrs5: {
      totalScore: latest.asrs5.totalScore,
      band: latest.asrs5.band,
      bandLabel: latest.asrs5.bandLabel,
      scaleScores: latest.asrs5.scaleScores,
      createdAt: latest.asrs5.createdAt,
    } } : {}),
    ...(include('ipip') ? { ipip: {
      domainScores: latest.ipip.domainScores,
      facetScores: latest.ipip.facetScores,
      createdAt: latest.ipip.createdAt,
    } } : {}),
    ...(include('hexaco') ? { hexaco: {
      domainScores: latest.hexaco.domainScores,
      createdAt: latest.hexaco.createdAt,
    } } : {}),
    ...(include('cerq') ? { cerq: {
      scaleScores: latest.cerq.scaleScores,
      createdAt: latest.cerq.createdAt,
    } } : {}),
    ...(include('cope') ? { cope: {
      scaleScores: latest.cope.scaleScores,
      createdAt: latest.cope.createdAt,
    } } : {}),
  };
}

function sourceAttemptsFromLatest(latest) {
  return {
    mood: { id: latest.mood.id, createdAt: latest.mood.createdAt },
    gad7: { id: latest.gad7.id, createdAt: latest.gad7.createdAt },
    panas: { id: latest.panas.id, createdAt: latest.panas.createdAt },
    asrs5: { id: latest.asrs5.id, createdAt: latest.asrs5.createdAt },
    ipip: { id: latest.ipip.id, createdAt: latest.ipip.createdAt },
    hexaco: { id: latest.hexaco.id, createdAt: latest.hexaco.createdAt },
    cerq: { id: latest.cerq.id, createdAt: latest.cerq.createdAt },
    cope: { id: latest.cope.id, createdAt: latest.cope.createdAt },
  };
}

function sourceAttemptsForKeys(latest, keys) {
  return Object.fromEntries(keys.map((key) => [
    key,
    latest[key] ? { id: latest[key].id, createdAt: latest[key].createdAt } : null,
  ]));
}

function sourceKeyFromAttempts(sourceAttempts, keys = ['mood', 'gad7', 'panas', 'asrs5', 'ipip', 'hexaco', 'cerq', 'cope']) {
  return keys
    .map((key) => `${key}:${sourceAttempts?.[key]?.id || 'missing'}`)
    .join('|');
}

async function loadSavedCombinedReport(userId, variant, sourceKey) {
  const { rows } = await pool.query(
    `SELECT profile, "sourceAttempts", "updatedAt"
     FROM wellbeing_combined_reports
     WHERE "userId"=$1 AND variant=$2 AND "sourceKey"=$3
     LIMIT 1`,
    [userId, variant, sourceKey]
  );
  if (!rows[0]) return null;
  return {
    profile: parseMaybeJson(rows[0].profile, {}),
    sourceAttempts: parseMaybeJson(rows[0].sourceAttempts, {}),
    updatedAt: rows[0].updatedAt,
  };
}

async function saveCombinedReport(userId, variant, sourceKey, sourceAttempts, profile) {
  await pool.query(
    `INSERT INTO wellbeing_combined_reports (
       "userId", variant, "sourceKey", "sourceAttempts", profile, "updatedAt"
     )
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT ("userId", variant, "sourceKey")
     DO UPDATE SET
       "sourceAttempts"=EXCLUDED."sourceAttempts",
       profile=EXCLUDED.profile,
       "updatedAt"=NOW()`,
    [
      userId,
      variant,
      sourceKey,
      JSON.stringify(sourceAttempts),
      JSON.stringify(profile),
    ]
  );
}

function moduleVariantKey(moduleKey, variant = 'detailed') {
  return `module:${moduleKey}:${variant}`;
}

async function loadOrGenerateModuleReport(userId, latest, module, variant = 'detailed', force = false) {
  const sourceAttempts = sourceAttemptsForKeys(latest, module.tests);
  const sourceKey = sourceKeyFromAttempts(sourceAttempts, module.tests);
  const cacheVariant = moduleVariantKey(module.key, variant);
  const saved = await loadSavedCombinedReport(userId, cacheVariant, sourceKey);
  if (saved && !force) {
    return {
      profile: saved.profile,
      sourceAttempts: saved.sourceAttempts,
      cached: true,
      savedAt: saved.updatedAt,
      cacheVariant,
    };
  }

  const profile = await generateCombinedProfile(userId, latest, {
    variant,
    moduleKey: module.key,
  });
  await saveCombinedReport(userId, cacheVariant, sourceKey, sourceAttempts, profile);
  return {
    profile,
    sourceAttempts,
    cached: false,
    cacheVariant,
  };
}

async function loadOrGenerateAllModuleReports(userId, latest, force = false, variant = 'detailed') {
  const reports = [];
  for (const module of WELLBEING_MODULES) {
    const result = await loadOrGenerateModuleReport(userId, latest, module, variant, force);
    reports.push({
      ...result.profile,
      moduleKey: module.key,
      moduleLabel: module.label,
      sourceAttempts: result.sourceAttempts,
      cached: result.cached,
      savedAt: result.savedAt,
    });
  }
  return reports;
}

function fallbackModuleReportFromLatest(latest, module) {
  const scores = buildCombinedScores(latest);
  return {
    ...buildModuleFallback(module, latest, scores, 'summary'),
    moduleKey: module.key,
    moduleLabel: module.label,
  };
}

async function loadSavedOrFallbackModuleReports(userId, latest, variant = 'summary') {
  const reports = [];
  for (const module of WELLBEING_MODULES) {
    const sourceAttempts = sourceAttemptsForKeys(latest, module.tests);
    const sourceKey = sourceKeyFromAttempts(sourceAttempts, module.tests);
    const saved = await loadSavedCombinedReport(userId, moduleVariantKey(module.key, variant), sourceKey)
      || (variant === 'summary'
        ? await loadSavedCombinedReport(userId, moduleVariantKey(module.key, 'detailed'), sourceKey)
        : null);
    reports.push({
      ...(saved?.profile || fallbackModuleReportFromLatest(latest, module)),
      moduleKey: module.key,
      moduleLabel: module.label,
      sourceAttempts,
      cached: !!saved,
      savedAt: saved?.updatedAt,
    });
  }
  return reports;
}

function fallbackFinalReportFromLatest(latest, moduleReports) {
  const scores = buildCombinedScores(latest);
  scores.moduleOutcomes = moduleReports.map((module) => ({
    key: module.moduleKey,
    label: module.moduleLabel,
    summary: module.summary,
  }));
  return buildCombinedFallback(latest, scores);
}

function cleanSlideshowText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatScaleScore(scale) {
  if (!scale || typeof scale !== 'object') return '';
  const label = scale.label || scale.name || scale.key || scale.code;
  const score = scale.score != null && scale.max != null ? `${scale.score}/${scale.max}` : scale.score;
  const band = scale.band?.label || scale.band;
  return cleanSlideshowText([
    label,
    score != null ? `(${score}${band ? `, ${band}` : ''})` : band ? `(${band})` : '',
  ].filter(Boolean).join(' '));
}

function strongestScales(scales, count = 4) {
  return [...(Array.isArray(scales) ? scales : [])]
    .sort((a, b) => Number(b.normalized || 0) - Number(a.normalized || 0))
    .slice(0, count);
}

function lowestScales(scales, count = 3) {
  return [...(Array.isArray(scales) ? scales : [])]
    .sort((a, b) => Number(a.normalized || 0) - Number(b.normalized || 0))
    .slice(0, count);
}

function topAnswerSignals(attempt, count = 4) {
  const analysis = attempt?.analysis || {};
  const fromAnalysis = analysis.topAreas
    || analysis.rationale?.drivers
    || analysis.rationale?.topAreas
    || analysis.rationale?.highest
    || [];
  const candidates = Array.isArray(fromAnalysis) && fromAnalysis.length
    ? fromAnalysis
    : [...(Array.isArray(attempt?.answers) ? attempt.answers : [])]
      .sort((a, b) => Number(b.score ?? b.value ?? b.scoredValue ?? 0) - Number(a.score ?? a.value ?? a.scoredValue ?? 0))
      .slice(0, count);
  return candidates.slice(0, count).map((item) => {
    const label = item.topic || item.label || item.statement || item.prompt || item.scaleLabel || item.scale || item.key;
    const score = item.score ?? item.value ?? item.scoredValue;
    const max = item.max ?? (score != null && Number(score) <= 3 ? 3 : null);
    return cleanSlideshowText(`${label || 'Signal'}${score != null ? ` (${score}${max ? `/${max}` : ''})` : ''}`);
  }).filter(Boolean);
}

function analysisSentences(attempt, count = 2) {
  const analysis = attempt?.analysis || {};
  return [analysis.summary, analysis.interpretation, analysis.rationale?.pattern]
    .flatMap((value) => cleanSlideshowText(value).split(/(?<=[.!?])\s+/))
    .filter((sentence) => sentence && !/not a diagnosis|not professional advice|not a substitute/i.test(sentence))
    .slice(0, count);
}

function createTestReport(key, label, attempt) {
  if (!attempt) return null;
  const bullets = [];
  const bandLabel = attempt.bandLabel || attempt.band?.label || attempt.band;
  if (attempt.totalScore != null) {
    const max = key === 'mood' ? 63 : key === 'gad7' ? 21 : key === 'asrs5' ? 24 : null;
    bullets.push(`${label} scored ${attempt.totalScore}${max ? `/${max}` : ''}${bandLabel ? `, in the "${bandLabel}" range` : ''}.`);
  }

  const scaleSource = attempt.scaleScores || attempt.domainScores || attempt.facetScores || [];
  const high = strongestScales(scaleSource, key === 'ipip' ? 5 : 4).map(formatScaleScore).filter(Boolean);
  const low = lowestScales(scaleSource, key === 'ipip' ? 3 : 2).map(formatScaleScore).filter(Boolean);
  const answerSignals = topAnswerSignals(attempt, 4);

  if (high.length) bullets.push(`Strongest score signals: ${high.join('; ')}.`);
  if (answerSignals.length && !high.length) bullets.push(`Most endorsed signals: ${answerSignals.join('; ')}.`);
  if (answerSignals.length && ['mood', 'gad7'].includes(key)) bullets.push(`The item-level drivers were ${answerSignals.join('; ')}.`);
  if (low.length && ['ipip', 'hexaco'].includes(key)) bullets.push(`Lower relative domains: ${low.join('; ')}.`);

  analysisSentences(attempt, 3).forEach((sentence) => {
    if (!bullets.some((item) => item.includes(sentence))) bullets.push(sentence);
  });

  if (key === 'panas' && high.length) {
    bullets.push('Read this as emotional tone at the time of testing: it helps separate low energy, active distress, and mixed affect.');
  }
  if (key === 'asrs5' && high.length) {
    bullets.push('Read this as attention and self-regulation friction that may amplify stress, delay, or recovery loops.');
  }
  if (key === 'cerq' && high.length) {
    bullets.push('Read this as the thinking pattern after stress arrives: which explanations keep distress active or help it settle.');
  }
  if (key === 'cope' && high.length) {
    bullets.push('Read this as the behavioural coping route: what the person tends to do with stress once it is noticed.');
  }

  return {
    key,
    title: label,
    subtitle: 'Individual test finding',
    takeaways: bullets.filter(Boolean).slice(0, 6),
  };
}

function buildTestReportsFromLatest(latest) {
  return [
    createTestReport('mood', 'BDI-Style Mood Check', latest.mood),
    createTestReport('gad7', 'GAD-7-Style Anxiety Check', latest.gad7),
    createTestReport('panas', 'PANAS-Style Affect Check', latest.panas),
    createTestReport('asrs5', 'ASRS-5-Style Attention Check', latest.asrs5),
    createTestReport('ipip', 'IPIP-NEO-120 Personality Inventory', latest.ipip),
    createTestReport('hexaco', 'HEXACO-60-Style Personality Check', latest.hexaco),
    createTestReport('cerq', 'CERQ-Style Cognitive Coping Check', latest.cerq),
    createTestReport('cope', 'Brief COPE-Style Coping Check', latest.cope),
  ].filter(Boolean);
}

function chartItem(label, normalized, valueLabel, group = '') {
  const value = Math.max(0, Math.min(1, Number(normalized) || 0));
  return {
    label: cleanSlideshowText(label),
    value,
    valueLabel: cleanSlideshowText(valueLabel || `${Math.round(value * 100)}%`),
    group,
  };
}

function chartItemsForAttempt(key, attempt) {
  if (!attempt) return [];
  if (key === 'mood') {
    return [chartItem('Mood load', Number(attempt.totalScore || 0) / 63, `${attempt.totalScore}/63`, 'Mood')];
  }
  if (key === 'gad7') {
    return [chartItem('Anxiety load', Number(attempt.totalScore || 0) / 21, `${attempt.totalScore}/21`, 'Mood')];
  }
  if (key === 'asrs5') {
    return [chartItem('Attention/self-regulation friction', Number(attempt.totalScore || 0) / 24, `${attempt.totalScore}/24`, 'Regulation')];
  }
  const scales = attempt.scaleScores || attempt.domainScores || [];
  return strongestScales(scales, ['ipip', 'hexaco'].includes(key) ? 6 : 5).map((scale) => chartItem(
    scale.label || scale.key || key,
    scale.normalized,
    scale.score != null && scale.max != null ? `${scale.score}/${scale.max}` : scale.band,
    ['ipip', 'hexaco'].includes(key) ? 'Traits' : key === 'panas' ? 'Affect' : 'Coping'
  ));
}

function buildSummaryChart(latest, keys = ['mood', 'gad7', 'panas', 'asrs5', 'ipip', 'hexaco', 'cerq', 'cope']) {
  const items = keys.flatMap((key) => chartItemsForAttempt(key, latest[key]));
  return {
    title: keys.length === 8 ? 'Summary chart' : 'Module summary chart',
    subtitle: 'Relative score/load map from the completed self-report checks',
    items: items.slice(0, keys.length === 8 ? 12 : 10),
  };
}

function nextStepBullets(latest, moduleKey = '') {
  const scores = buildCombinedScores(latest);
  return describeSuggestedNextSteps(scores, moduleKey || 'overall')
    .split(/\n{2,}/)
    .map(cleanSlideshowText)
    .filter(Boolean)
    .slice(0, 6);
}

function moduleSafeFilename(value) {
  return String(value || 'wellbeing')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function buildWellbeingSlideshowContent(userId, latest, moduleKey = '') {
  const requestedModule = moduleKey ? WELLBEING_MODULES.find((module) => module.key === moduleKey) : null;
  const allTestReports = buildTestReportsFromLatest(latest);
  if (requestedModule) {
    const moduleReports = (await loadSavedOrFallbackModuleReports(userId, latest, 'summary'))
      .filter((report) => report.moduleKey === requestedModule.key);
    return {
      moduleReports,
      finalProfile: null,
      testReports: allTestReports.filter((report) => requestedModule.tests.includes(report.key)),
      chart: buildSummaryChart(latest, requestedModule.tests),
      nextSteps: {
        title: `${requestedModule.label} next steps`,
        subtitle: 'Supportive steps from this module',
        bullets: nextStepBullets(latest, requestedModule.key),
      },
      scopeLabel: requestedModule.label,
      filename: `wellbeing-${moduleSafeFilename(requestedModule.key)}-slideshow.pptx`,
      sourceAttempts: sourceAttemptsForKeys(latest, requestedModule.tests),
      cachedFinal: false,
    };
  }

  const moduleReports = await loadSavedOrFallbackModuleReports(userId, latest, 'summary');
  const sourceAttempts = sourceAttemptsFromLatest(latest);
  const sourceKey = sourceKeyFromAttempts(sourceAttempts);
  const cacheVariant = 'final:summary:modules';
  const saved = await loadSavedCombinedReport(userId, cacheVariant, sourceKey)
    || await loadSavedCombinedReport(userId, 'final:detailed:modules', sourceKey);
  const finalProfile = saved?.profile || fallbackFinalReportFromLatest(latest, moduleReports);
  const testReports = allTestReports;
  return {
    moduleReports,
    finalProfile,
    testReports,
    chart: buildSummaryChart(latest),
    nextSteps: {
      title: 'Suggested next steps',
      subtitle: 'Supportive habits and reflection steps',
      bullets: nextStepBullets(latest),
    },
    scopeLabel: 'Final overall recap',
    filename: 'wellbeing-final-recap-slideshow.pptx',
    sourceAttempts,
    cachedFinal: !!saved,
  };
}

router.get('/profile/status', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    res.json({
      ...profileStatusFromLatest(latest),
      modules: moduleStatusFromLatest(latest),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/profile', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    const status = profileStatusFromLatest(latest);
    const modules = moduleStatusFromLatest(latest);
    const requestedModuleKey = typeof req.body?.moduleKey === 'string' ? req.body.moduleKey : '';
    const requestedModule = WELLBEING_MODULES.find((module) => module.key === requestedModuleKey);
    const requestedModuleStatus = modules.find((module) => module.key === requestedModuleKey);
    if (requestedModule && !requestedModuleStatus?.completed) {
      return res.status(400).json({
        error: `${requestedModule.label} report requires its module tests to be completed first.`,
        status: { ...status, modules },
      });
    }
    if (!requestedModule && !status.available) {
      return res.status(400).json({
        error: 'Combined profile requires all eight tests to be completed first.',
        status: { ...status, modules },
      });
    }

    const variant = ['summary', 'analytical', 'suggestions'].includes(req.body?.variant) ? req.body.variant : 'detailed';
    if (requestedModule) {
      const result = await loadOrGenerateModuleReport(
        req.user.id,
        latest,
        requestedModule,
        variant,
        !!req.body?.force
      );
      return res.json({
        profile: result.profile,
        variant,
        moduleKey: requestedModule.key,
        moduleLabel: requestedModule.label,
        sourceAttempts: result.sourceAttempts,
        cached: result.cached,
        savedAt: result.savedAt,
      });
    }

    const sourceAttempts = sourceAttemptsFromLatest(latest);
    const sourceKey = sourceKeyFromAttempts(sourceAttempts);
    const cacheVariant = `final:${variant}:modules`;
    const saved = await loadSavedCombinedReport(req.user.id, cacheVariant, sourceKey);
    if (saved && !req.body?.force) {
      return res.json({
        profile: saved.profile,
        variant,
        sourceAttempts: saved.sourceAttempts,
        cached: true,
        savedAt: saved.updatedAt,
      });
    }

    const moduleReports = await loadOrGenerateAllModuleReports(req.user.id, latest);
    const profile = await generateCombinedProfile(req.user.id, latest, { variant, moduleReports });
    await saveCombinedReport(req.user.id, cacheVariant, sourceKey, sourceAttempts, profile);
    res.json({
      profile,
      variant,
      sourceAttempts,
      moduleReports,
      cached: false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/profile/visuals', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    const status = profileStatusFromLatest(latest);
    const modules = moduleStatusFromLatest(latest);
    const requestedModule = WELLBEING_MODULES.find((module) => module.key === req.query?.moduleKey);
    const requestedModuleStatus = requestedModule ? modules.find((module) => module.key === requestedModule.key) : null;
    if (requestedModule && !requestedModuleStatus?.completed) {
      return res.status(400).json({
        error: `${requestedModule.label} visuals require its module tests to be completed first.`,
        status: { ...status, modules },
      });
    }
    if (!requestedModule && !status.available) {
      return res.status(400).json({
        error: 'Visual summary requires all eight tests to be completed first.',
        status: { ...status, modules },
      });
    }

    res.json({
      status: { ...status, modules },
      moduleKey: requestedModule?.key || '',
      moduleLabel: requestedModule?.label || '',
      ...visualProfileFromLatest(latest, requestedModule?.tests),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/profile/visuals/pdf', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    const status = profileStatusFromLatest(latest);
    if (!status.available) {
      return res.status(400).json({
        error: 'Visual summary PDF requires all eight tests to be completed first.',
        status,
      });
    }

    const view = req.query?.view === 'mindmap' ? 'mindmap' : 'charts';
    const buf = await buildWellbeingVisualPdfBuffer({
      visuals: {
        status,
        ...visualProfileFromLatest(latest),
      },
      view,
    });
    const filename = view === 'mindmap' ? 'wellbeing-mind-map.pdf' : 'wellbeing-visual-summary.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('[wellbeing visuals pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/random-attempts', async (req, res) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const attempts = {
      mood: await insertRandomMoodAttempt(client, req.user.id),
      gad7: await insertRandomGad7Attempt(client, req.user.id),
      panas: await insertRandomPanasAttempt(client, req.user.id),
      asrs5: await insertRandomAsrs5Attempt(client, req.user.id),
      ipip: await insertRandomIpipAttempt(client, req.user.id),
      hexaco: await insertRandomHexacoAttempt(client, req.user.id),
      cerq: await insertRandomCerqAttempt(client, req.user.id),
      cope: await insertRandomCopeAttempt(client, req.user.id),
    };
    await client.query('COMMIT');
    res.json({
      ok: true,
      generated: true,
      attempts,
      note: 'Generated random admin demo data. These are not real self-report results.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/admin/invite', async (req, res) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid participant email is required.' });
  }

  const client = await pool.connect();
  let created = false;
  let userId = null;
  const setupToken = crypto.randomBytes(32).toString('hex');
  const setupExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      'SELECT id, "isAdmin" FROM users WHERE email=$1',
      [email]
    );
    const existing = existingRows[0];
    if (existing?.isAdmin) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot send a wellbeing participant invite by resetting an admin account password.' });
    }

    if (existing) {
      userId = existing.id;
      await client.query('UPDATE users SET "mustChangePassword"=TRUE WHERE id=$1', [userId]);
      await client.query('DELETE FROM auth_sessions WHERE "userId"=$1', [userId]);
    } else {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);
      const { rows } = await client.query(
        'INSERT INTO users (email, "passwordHash", "isAdmin", "mustChangePassword") VALUES ($1, $2, FALSE, TRUE) RETURNING id',
        [email, passwordHash]
      );
      userId = rows[0].id;
      created = true;
    }
    await client.query('DELETE FROM password_resets WHERE email=$1', [email]);
    await client.query(
      'INSERT INTO password_resets (token, email, "expiresAt") VALUES ($1, $2, $3)',
      [setupToken, email, setupExpiresAt]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    return res.status(500).json({ error: err.message });
  }
  client.release();

  try {
    const appUrl = getAppUrl(req);
    const link = `${appUrl}/reset-password?token=${setupToken}&next=${encodeURIComponent('/wellbeing')}`;
    const template = await loadWellbeingInviteTemplate();
    const html = renderWellbeingInviteHtml({
      body: template.body,
      email,
      link,
    });
    const emailResult = await sendEmail({ to: email, subject: template.subject, html });
    if (emailResult?.skipped) {
      return res.status(503).json({
        error: `Participant account ${created ? 'created' : 'updated'}, but the invite email was not sent: ${emailResult.reason}`,
        created,
        userId,
        email,
        link,
        emailSkipped: true,
      });
    }
    res.json({ ok: true, created, userId, email, link, setupRequired: true });
  } catch (err) {
    console.error('[wellbeing invite email]', err);
    res.status(500).json({
      error: `Participant account ${created ? 'created' : 'updated'}, but the invite email could not be sent: ${err.message}`,
      created,
      userId,
      email,
    });
  }
});

router.post('/profile/pdf', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    const status = profileStatusFromLatest(latest);
    if (!status.available) {
      return res.status(400).json({
        error: 'Combined profile PDF requires all eight tests to be completed first.',
        status,
      });
    }

    const profile = req.body?.profile;
    if (!profile || typeof profile !== 'object') {
      return res.status(400).json({ error: 'Generated combined profile is required.' });
    }

    const sourceAttempts = req.body?.sourceAttempts || sourceAttemptsFromLatest(latest);

    const buf = await buildCombinedProfilePdfBuffer({ profile, sourceAttempts });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="combined-wellbeing-profile.pdf"');
    res.send(buf);
  } catch (err) {
    console.error('[combined profile pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/profile/slideshow', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    const status = profileStatusFromLatest(latest);
    const modules = moduleStatusFromLatest(latest);
    const requestedModule = WELLBEING_MODULES.find((module) => module.key === req.query?.moduleKey);
    const requestedModuleStatus = requestedModule ? modules.find((module) => module.key === requestedModule.key) : null;
    if (requestedModule && !requestedModuleStatus?.completed) {
      return res.status(400).json({
        error: `${requestedModule.label} slideshow requires its module tests to be completed first.`,
        status: { ...status, modules },
      });
    }
    if (!requestedModule && !status.available) {
      return res.status(400).json({
        error: 'Wellbeing takeaway slideshow requires all eight tests to be completed first.',
        status: { ...status, modules },
      });
    }

    const {
      moduleReports,
      finalProfile,
      testReports,
      chart,
      nextSteps,
      scopeLabel,
      filename,
    } = await buildWellbeingSlideshowContent(req.user.id, latest, requestedModule?.key || '');
    const buf = await buildWellbeingSlideshowBuffer({
      moduleReports,
      finalProfile,
      testReports,
      chart,
      nextSteps,
      scopeLabel,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('[wellbeing slideshow]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/profile/slideshow/preview', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    const status = profileStatusFromLatest(latest);
    const modules = moduleStatusFromLatest(latest);
    const requestedModule = WELLBEING_MODULES.find((module) => module.key === req.query?.moduleKey);
    const requestedModuleStatus = requestedModule ? modules.find((module) => module.key === requestedModule.key) : null;
    if (requestedModule && !requestedModuleStatus?.completed) {
      return res.status(400).json({
        error: `${requestedModule.label} slideshow requires its module tests to be completed first.`,
        status: { ...status, modules },
      });
    }
    if (!requestedModule && !status.available) {
      return res.status(400).json({
        error: 'Wellbeing takeaway slideshow requires all eight tests to be completed first.',
        status: { ...status, modules },
      });
    }

    const {
      moduleReports,
      finalProfile,
      testReports,
      chart,
      nextSteps,
      scopeLabel,
      sourceAttempts,
      cachedFinal,
    } = await buildWellbeingSlideshowContent(req.user.id, latest, requestedModule?.key || '');
    res.json({
      status: { ...status, modules },
      moduleKey: requestedModule?.key || '',
      moduleLabel: requestedModule?.label || '',
      sourceAttempts,
      cachedFinal,
      slideshow: buildWellbeingSlideshowData({
        moduleReports,
        finalProfile,
        testReports,
        chart,
        nextSteps,
        scopeLabel,
      }),
    });
  } catch (err) {
    console.error('[wellbeing slideshow preview]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/reset', async (req, res) => {
  try {
    const [mood, gad7, panas, asrs5, ipip, hexaco, cerq, cope, combinedReports] = await Promise.all([
      pool.query('DELETE FROM wellbeing_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM gad7_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM panas_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM asrs5_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM ipip_neo_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM hexaco_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM cerq_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM cope_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM wellbeing_combined_reports WHERE "userId"=$1', [req.user.id]),
    ]);

    res.json({
      ok: true,
      deleted: {
        mood: mood.rowCount,
        gad7: gad7.rowCount,
        panas: panas.rowCount,
        asrs5: asrs5.rowCount,
        ipip: ipip.rowCount,
        hexaco: hexaco.rowCount,
        cerq: cerq.rowCount,
        cope: cope.rowCount,
        combinedReports: combinedReports.rowCount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/attempts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "questionnaireVersion", "totalScore", band, "bandLabel", "safetyFlag", "createdAt"
       FROM wellbeing_attempts
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/attempts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM wellbeing_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = rows[0];
    attempt.analysis = parseMaybeJson(attempt.analysis, {});
    attempt.answers = parseMaybeJson(attempt.answers, []);
    if (!attempt.analysis.modelInsight || attempt.analysis.modelInsight.formatVersion !== 2) {
      attempt.analysis.modelInsight = await generateModelInsight(req.user.id, {
        title: 'BDI-Style Mood Check',
        purpose: 'Interpret a proof-of-concept mood symptom self-check inspired by BDI-style symptom domains. Focus on symptom pattern, context, and reflective next questions without diagnosing.',
        scores: {
          totalScore: attempt.totalScore,
          band: { key: attempt.band, label: attempt.bandLabel },
          topAreas: attempt.analysis.topAreas,
          answers: attempt.answers,
        },
        existingAnalysis: attempt.analysis,
        scoreLines: [
          `Total: ${attempt.totalScore}/63 (${attempt.bandLabel})`,
          ...attempt.answers
            .filter((answer) => Number(answer.score) >= 2)
            .sort((a, b) => Number(b.score) - Number(a.score) || Number(a.questionId) - Number(b.questionId))
            .slice(0, 8)
            .map((answer) => `${answer.topic}: ${answer.score}/3`),
        ],
      });
      await pool.query('UPDATE wellbeing_attempts SET analysis=$1 WHERE id=$2 AND "userId"=$3', [JSON.stringify(attempt.analysis), req.params.id, req.user.id]);
    }
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/attempts/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM wellbeing_attempts
       WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });

    const buf = await buildWellbeingPdfBuffer({ attempt: rows[0] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="wellbeing-check-${req.params.id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[wellbeing pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/attempts', async (req, res) => {
  try {
    const answers = normalizeAnswers(req.body?.answers);
    const totalScore = answers.reduce((sum, answer) => sum + answer.score, 0);
    const band = bandForScore(totalScore);
    const analysis = buildAnalysis(answers, totalScore, band);
    const safetyAnswer = answers.find((answer) => answer.key === 'suicidalThoughts');
    analysis.modelInsight = await generateModelInsight(req.user.id, {
      title: 'BDI-Style Mood Check',
      purpose: 'Interpret a proof-of-concept mood symptom self-check inspired by BDI-style symptom domains. Focus on symptom pattern, context, and reflective next questions without diagnosing.',
      scores: { totalScore, band, topAreas: analysis.topAreas, answers },
      existingAnalysis: analysis,
      scoreLines: [
        `Total: ${totalScore}/63 (${band.label})`,
        ...answers
          .filter((answer) => answer.score >= 2)
          .sort((a, b) => b.score - a.score || a.questionId - b.questionId)
          .slice(0, 8)
          .map((answer) => `${answer.topic}: ${answer.score}/3`),
      ],
    });

    const { rows } = await pool.query(
      `INSERT INTO wellbeing_attempts (
         "userId", "questionnaireVersion", answers, "totalScore", band, "bandLabel",
         analysis, "safetyFlag", "suicidalThoughtScore"
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        req.user.id,
        QUESTIONNAIRE_VERSION,
        JSON.stringify(answers),
        totalScore,
        band.key,
        band.label,
        JSON.stringify(analysis),
        analysis.safetyFlag,
        Number(safetyAnswer?.score || 0),
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    const status = /required|Expected|Invalid|out of order/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/attempts/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM wellbeing_attempts WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
