'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { buildWellbeingPdfBuffer } = require('../services/wellbeingPdf');
const { buildCombinedProfilePdfBuffer } = require('../services/combinedProfilePdf');
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
} = require('../services/wellbeingModelInsights');

const QUESTIONNAIRE_VERSION = 'wellbeing-check-v1';

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

async function loadLatestProfileInputs(userId) {
  const [mood, ipip, cerq, cope] = await Promise.all([
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
       FROM ipip_neo_attempts
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
    ipip: ipip.rows[0] || null,
    cerq: cerq.rows[0] || null,
    cope: cope.rows[0] || null,
  };

  if (latest.mood) {
    latest.mood.analysis = parseMaybeJson(latest.mood.analysis, {});
    latest.mood.answers = parseMaybeJson(latest.mood.answers, []);
  }
  if (latest.ipip) {
    latest.ipip.analysis = parseMaybeJson(latest.ipip.analysis, {});
    latest.ipip.answers = parseMaybeJson(latest.ipip.answers, []);
    latest.ipip.facetScores = parseMaybeJson(latest.ipip.facetScores, []);
    latest.ipip.domainScores = parseMaybeJson(latest.ipip.domainScores, []);
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
    { key: 'ipip', label: 'IPIP-NEO-120 Personality Inventory', completed: !!latest.ipip, completedAt: latest.ipip?.createdAt || null },
    { key: 'cerq', label: 'CERQ-Style Cognitive Coping Check', completed: !!latest.cerq, completedAt: latest.cerq?.createdAt || null },
    { key: 'cope', label: 'Brief COPE-Style Coping Check', completed: !!latest.cope, completedAt: latest.cope?.createdAt || null },
  ];
  return {
    available: tests.every((test) => test.completed),
    tests,
    missing: tests.filter((test) => !test.completed).map((test) => test.key),
  };
}

router.get('/profile/status', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    res.json(profileStatusFromLatest(latest));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/profile', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    const status = profileStatusFromLatest(latest);
    if (!status.available) {
      return res.status(400).json({
        error: 'Combined profile requires all four tests to be completed first.',
        status,
      });
    }

    const profile = await generateCombinedProfile(req.user.id, latest);
    res.json({
      profile,
      sourceAttempts: {
        mood: { id: latest.mood.id, createdAt: latest.mood.createdAt },
        ipip: { id: latest.ipip.id, createdAt: latest.ipip.createdAt },
        cerq: { id: latest.cerq.id, createdAt: latest.cerq.createdAt },
        cope: { id: latest.cope.id, createdAt: latest.cope.createdAt },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/profile/pdf', async (req, res) => {
  try {
    const latest = await loadLatestProfileInputs(req.user.id);
    const status = profileStatusFromLatest(latest);
    if (!status.available) {
      return res.status(400).json({
        error: 'Combined profile PDF requires all four tests to be completed first.',
        status,
      });
    }

    const profile = req.body?.profile;
    if (!profile || typeof profile !== 'object') {
      return res.status(400).json({ error: 'Generated combined profile is required.' });
    }

    const sourceAttempts = req.body?.sourceAttempts || {
      mood: { id: latest.mood.id, createdAt: latest.mood.createdAt },
      ipip: { id: latest.ipip.id, createdAt: latest.ipip.createdAt },
      cerq: { id: latest.cerq.id, createdAt: latest.cerq.createdAt },
      cope: { id: latest.cope.id, createdAt: latest.cope.createdAt },
    };

    const buf = await buildCombinedProfilePdfBuffer({ profile, sourceAttempts });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="combined-wellbeing-profile.pdf"');
    res.send(buf);
  } catch (err) {
    console.error('[combined profile pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/reset', async (req, res) => {
  try {
    const [mood, ipip, cerq, cope] = await Promise.all([
      pool.query('DELETE FROM wellbeing_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM ipip_neo_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM cerq_attempts WHERE "userId"=$1', [req.user.id]),
      pool.query('DELETE FROM cope_attempts WHERE "userId"=$1', [req.user.id]),
    ]);

    res.json({
      ok: true,
      deleted: {
        mood: mood.rowCount,
        ipip: ipip.rowCount,
        cerq: cerq.rowCount,
        cope: cope.rowCount,
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
