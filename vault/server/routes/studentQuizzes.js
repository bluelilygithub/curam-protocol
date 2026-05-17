'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { FEATURE_ACCESS_DEFAULTS } = require('../config/featureAccess');
const { getModelsForUser } = require('../services/modelResolver');
const { callModel } = require('../services/callModel');
const { parseModelJson } = require('../utils/parseModelJson');

async function canAccessStudentWorkspaceFeature(user) {
  if (user?.isAdmin) return true;
  const { rows } = await pool.query(
    "SELECT value FROM workspace_settings WHERE key = 'feature_student' LIMIT 1"
  );
  const raw = String(rows[0]?.value ?? FEATURE_ACCESS_DEFAULTS.student).trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

router.use(async (req, res, next) => {
  if (!(await canAccessStudentWorkspaceFeature(req.user))) {
    return res.status(403).json({ error: 'Student feature is disabled for this workspace.' });
  }
  next();
});

function mapQuizRow(row) {
  if (!row) return null;
  const poolQ = row.questionPool;
  const questionPool = Array.isArray(poolQ) ? poolQ : (typeof poolQ === 'string' ? JSON.parse(poolQ) : []);
  const types = row.questionTypes;
  const questionTypes = Array.isArray(types) ? types : (typeof types === 'string' ? JSON.parse(types) : []);
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    topic: row.topic,
    level: row.level,
    questionCount: Number(row.questionCount),
    questionTypes,
    passmark: Number(row.passmark),
    tags: row.tags || [],
    questionPool,
    poolSize: questionPool.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeQuestion(q, index) {
  const id = q.id != null ? String(q.id) : `q-${index + 1}`;
  const type = ['true_false', 'multiple_choice', 'short_answer'].includes(q.type) ? q.type : 'multiple_choice';
  let options = q.options;
  if (type === 'multiple_choice' && !Array.isArray(options)) options = [];
  if (type === 'true_false') options = ['True', 'False'];
  return {
    id,
    type,
    question: String(q.question || '').trim(),
    options: type === 'multiple_choice' ? options.map(String) : (type === 'true_false' ? ['True', 'False'] : []),
    correct_answer: q.correct_answer != null ? String(q.correct_answer) : '',
    explanation: String(q.explanation || '').trim(),
    subtopic: String(q.subtopic || 'General').trim(),
  };
}

async function generateQuestionPoolForUser(userId, { topic, level, types, count }) {
  const { standard: model } = await getModelsForUser(userId);
  if (!model) throw new Error('No model configured. Ask an admin to set models in Settings → AI & Chat.');

  const n = Math.max(2, Math.min(60, Number(count) || 10)) * 2;
  const typesStr = (types || []).join(', ') || 'multiple_choice, true_false, short_answer';
  const prompt = `Generate ${n} quiz questions on the topic: ${topic}. Academic level: ${level}.
Question types to include: ${typesStr}.
For each question return JSON with:
{ "id", "type" ("true_false"|"multiple_choice"|"short_answer"), "question", "options" (array, for MC only), "correct_answer", "explanation", "subtopic" }
For short_answer, correct_answer should be a model answer with key concepts.
For true_false, correct_answer must be "true" or "false" (lowercase).
For multiple_choice, options must be exactly 4 strings; correct_answer must match one option text exactly.
Return a JSON array only, no other text.`;

  const raw = await callModel(model, prompt, { maxTokens: 16000 });
  const parsed = parseModelJson(raw);
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error('Could not parse generated questions. Try again.');
  }
  return parsed.map(normalizeQuestion).filter((q) => q.question);
}

router.get('/dashboard', async (req, res) => {
  try {
    const { rows: quizzes } = await pool.query(
      'SELECT id, category FROM student_quizzes WHERE "userId"=$1',
      [req.user.id]
    );
    const { rows: attempts } = await pool.query(
      `SELECT a.id, a."quizId", a."scorePercent", a.passed, a."createdAt", a."questionResults", q.category, q.title
       FROM student_quiz_attempts a
       JOIN student_quizzes q ON q.id = a."quizId"
       WHERE a."userId"=$1
       ORDER BY a."createdAt" ASC`,
      [req.user.id]
    );

    const totalQuizzes = quizzes.length;
    const totalAttempts = attempts.length;
    let scoreSum = 0;
    const scoreHistory = [];
    const categoryScores = {};
    const subtopicWrong = {};

    attempts.forEach((a) => {
      const score = Number(a.scorePercent);
      scoreSum += score;
      scoreHistory.push({
        attemptId: a.id,
        quizId: a.quizId,
        quizTitle: a.title,
        score,
        date: a.createdAt,
      });
      const cat = a.category || 'Uncategorised';
      if (!categoryScores[cat]) categoryScores[cat] = { sum: 0, n: 0 };
      categoryScores[cat].sum += score;
      categoryScores[cat].n += 1;

      const results = Array.isArray(a.questionResults) ? a.questionResults : [];
      results.forEach((r) => {
        if (!r.correct && r.subtopic) {
          subtopicWrong[r.subtopic] = (subtopicWrong[r.subtopic] || 0) + 1;
        }
      });
    });

    const overallAverage = totalAttempts ? Math.round((scoreSum / totalAttempts) * 10) / 10 : null;

    const sortedDays = [...new Set(attempts.map((a) => new Date(a.createdAt).toDateString()))].sort(
      (a, b) => new Date(b) - new Date(a)
    );
    let streak = 0;
    const today = new Date().toDateString();
    let cursor = new Date();
    for (let i = 0; i < 400; i++) {
      const d = cursor.toDateString();
      if (sortedDays.includes(d)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else if (d === today && i === 0) {
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }

    const categoryBreakdown = Object.entries(categoryScores).map(([category, v]) => ({
      category,
      averageScore: Math.round((v.sum / v.n) * 10) / 10,
      attempts: v.n,
    }));

    const weakSpots = Object.entries(subtopicWrong)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([subtopic, count]) => ({ subtopic, count }));

    res.json({
      totalQuizzes,
      totalAttempts,
      overallAverage,
      streak,
      scoreHistory,
      categoryBreakdown,
      weakSpots,
      quizzes: quizzes.map((q) => ({ id: q.id, category: q.category })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT category FROM student_quizzes WHERE "userId"=$1 AND category <> '' ORDER BY category`,
      [req.user.id]
    );
    res.json({ categories: rows.map((r) => r.category) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/attempts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, q.title AS "quizTitle", q.passmark, q.category
       FROM student_quiz_attempts a
       JOIN student_quizzes q ON q.id = a."quizId"
       WHERE a."userId"=$1
       ORDER BY a."createdAt" DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(rows.map((r) => ({
      id: r.id,
      quizId: r.quizId,
      quizTitle: r.quizTitle,
      category: r.category,
      scorePercent: Number(r.scorePercent),
      timeTakenMs: Number(r.timeTakenMs),
      passed: r.passed,
      passmark: Number(r.passmark),
      createdAt: r.createdAt,
      questionResults: r.questionResults,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/attempts/:attemptId/summary', async (req, res) => {
  const attemptId = Number(req.params.attemptId);
  if (!attemptId) return res.status(400).json({ error: 'Invalid attempt id' });

  try {
    const { rows } = await pool.query(
      `SELECT a."questionResults", a."scorePercent", a.passed, q.title, q.topic, q.level, a."performanceSummary"
       FROM student_quiz_attempts a
       JOIN student_quizzes q ON q.id = a."quizId"
       WHERE a.id=$1 AND a."userId"=$2`,
      [attemptId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const row = rows[0];

    if (row.performanceSummary && typeof row.performanceSummary === 'object') {
      return res.json(row.performanceSummary);
    }

    const results = Array.isArray(row.questionResults) ? row.questionResults : [];
    const wrong = results.filter((r) => !r.correct);
    const subtopics = [...new Set(wrong.map((r) => r.subtopic).filter(Boolean))];

    const { standard: model } = await getModelsForUser(req.user?.id);
    if (!model) return res.status(400).json({ error: 'No model configured in Settings.' });

    const wrongLines = wrong.slice(0, 15).map((r, i) =>
      `${i + 1}. [${r.subtopic || 'General'}] Q: ${r.question}\n   Student: ${r.studentAnswer || '—'}\n   Correct: ${r.correctAnswer || '—'}`
    ).join('\n');

    const prompt = `You are a study coach. The student completed a quiz on "${row.topic}" (${row.level}, title: "${row.title}").
Score: ${row.scorePercent}% (${row.passed ? 'passed' : 'did not pass'}).

Incorrect or weak answers:
${wrongLines || '(none — perfect score)'}

Subtopics missed: ${subtopics.join(', ') || 'none'}

Write a brief, encouraging performance summary (2–4 sentences) and list 2–4 specific focus areas to study next.
Return JSON only: { "summary": "...", "focusAreas": ["...", "..."] }`;

    const raw = await callModel(model, prompt, { maxTokens: 800 });
    const parsed = parseModelJson(raw);
    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ error: 'Could not parse performance summary' });
    }

    const payload = {
      summary: String(parsed.summary || '').trim(),
      focusAreas: Array.isArray(parsed.focusAreas)
        ? parsed.focusAreas.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
        : [],
      generatedAt: new Date().toISOString(),
    };

    await pool.query(
      'UPDATE student_quiz_attempts SET "performanceSummary"=$1 WHERE id=$2 AND "userId"=$3',
      [JSON.stringify(payload), attemptId, req.user.id]
    );

    res.json(payload);
  } catch (err) {
    console.error('[student-quizzes summary]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/attempts/:attemptId', async (req, res) => {
  try {
    const attemptId = Number(req.params.attemptId);
    const { rows } = await pool.query(
      `SELECT a.*, q.title, q.topic, q.passmark, q.category, q."questionPool"
       FROM student_quiz_attempts a
       JOIN student_quizzes q ON q.id = a."quizId"
       WHERE a.id=$1 AND a."userId"=$2`,
      [attemptId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const row = rows[0];
    res.json({
      id: row.id,
      quizId: row.quizId,
      title: row.title,
      topic: row.topic,
      category: row.category,
      passmark: Number(row.passmark),
      scorePercent: Number(row.scorePercent),
      timeTakenMs: Number(row.timeTakenMs),
      passed: row.passed,
      createdAt: row.createdAt,
      questionResults: row.questionResults,
      questionPool: row.questionPool,
      performanceSummary: row.performanceSummary || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/attempts', async (req, res) => {
  const { quizId, scorePercent, timeTakenMs, passed, questionResults } = req.body || {};
  const qid = Number(quizId);
  if (!qid) return res.status(400).json({ error: 'quizId required' });

  try {
    const { rows: check } = await pool.query(
      'SELECT id FROM student_quizzes WHERE id=$1 AND "userId"=$2',
      [qid, req.user.id]
    );
    if (!check[0]) return res.status(404).json({ error: 'Quiz not found' });

    const { rows } = await pool.query(
      `INSERT INTO student_quiz_attempts ("userId", "quizId", "scorePercent", "timeTakenMs", passed, "questionResults")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.user.id,
        qid,
        Number(scorePercent) || 0,
        Number(timeTakenMs) || 0,
        !!passed,
        JSON.stringify(questionResults || []),
      ]
    );
    res.status(201).json({
      id: rows[0].id,
      quizId: rows[0].quizId,
      scorePercent: Number(rows[0].scorePercent),
      timeTakenMs: Number(rows[0].timeTakenMs),
      passed: rows[0].passed,
      createdAt: rows[0].createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mark-short', async (req, res) => {
  const { question, correct_answer, student_answer } = req.body || {};
  if (!question || !student_answer) {
    return res.status(400).json({ error: 'question and student_answer required' });
  }
  try {
    const { standard: model } = await getModelsForUser(req.user?.id);
    if (!model) return res.status(400).json({ error: 'No model configured in Settings.' });

    const prompt = `The question was: ${question}
The model answer is: ${correct_answer || ''}
The student answered: ${student_answer}
Mark this out of 10 and return JSON: { "score" (0-10), "correct" (bool, true if score >= 6), "feedback" (one sentence) }
Return JSON only.`;

    const raw = await callModel(model, prompt, { maxTokens: 400 });
    const parsed = parseModelJson(raw);
    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ error: 'Could not parse marking response' });
    }
    const score = Math.max(0, Math.min(10, Number(parsed.score) || 0));
    const correct = parsed.correct != null ? !!parsed.correct : score >= 6;
    res.json({
      score,
      correct,
      feedback: String(parsed.feedback || '').trim(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, category, topic, level, "questionCount", "questionTypes", passmark, tags,
              jsonb_array_length("questionPool") AS "poolSize", "createdAt", "updatedAt"
       FROM student_quizzes WHERE "userId"=$1
       ORDER BY "updatedAt" DESC`,
      [req.user.id]
    );
    res.json(rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      topic: r.topic,
      level: r.level,
      questionCount: Number(r.questionCount),
      questionTypes: r.questionTypes,
      passmark: Number(r.passmark),
      tags: r.tags || [],
      poolSize: Number(r.poolSize) || 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const {
    title,
    category,
    topic,
    level,
    questionCount,
    questionTypes,
    passmark,
    tags,
  } = req.body || {};

  if (!title?.trim() || !topic?.trim()) {
    return res.status(400).json({ error: 'title and topic are required' });
  }

  const types = Array.isArray(questionTypes) && questionTypes.length
    ? questionTypes.filter((t) => ['true_false', 'multiple_choice', 'short_answer'].includes(t))
    : ['multiple_choice', 'true_false'];

  try {
    const questionPool = await generateQuestionPoolForUser(req.user.id, {
      topic: topic.trim(),
      level: level || '1st year',
      types,
      count: Number(questionCount) || 10,
    });

    const tagList = typeof tags === 'string'
      ? tags.split(',').map((t) => t.trim()).filter(Boolean)
      : (Array.isArray(tags) ? tags.map(String) : []);

    const { rows } = await pool.query(
      `INSERT INTO student_quizzes
        ("userId", title, category, topic, level, "questionCount", "questionTypes", passmark, tags, "questionPool")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.user.id,
        title.trim(),
        (category || '').trim(),
        topic.trim(),
        level || '1st year',
        Math.max(1, Math.min(30, Number(questionCount) || 10)),
        JSON.stringify(types),
        Math.max(0, Math.min(100, Number(passmark) || 80)),
        tagList,
        JSON.stringify(questionPool),
      ]
    );
    res.status(201).json(mapQuizRow(rows[0]));
  } catch (err) {
    console.error('[student-quizzes create]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM student_quizzes WHERE id=$1 AND "userId"=$2',
      [Number(req.params.id), req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Quiz not found' });
    res.json(mapQuizRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM student_quizzes WHERE id=$1 AND "userId"=$2',
      [Number(req.params.id), req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Quiz not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
