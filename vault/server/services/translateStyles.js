'use strict';

// House styles for Translate: per language, sets of approved examples an admin keeps for the whole workspace. A set is a kind of
// content ("Corporate vision statements") with a comment on how it should be translated (register, idiom, what to keep) and pairs of
// an original and its approved translation. Most languages have none; when a translation into or out of a language with sets runs,
// one set is used (the one picked on New translation, or the closest one when "Let Translate choose"), and its comment and examples
// go to the translator as the standard to match and to the checker as the standard to judge by. Translation memory is skipped for
// such a job, so old wording cannot bypass the examples. See docs/translate-agent.md "House styles".

const { pool } = require('../db');
const { callModel } = require('./callModel');
const { langName } = require('./translateLlmService');

const MAX_EXAMPLES_PER_SET = 30;
const MAX_TEXT = 4000;          // one side of one example
const BLOCK_CHAR_BUDGET = 6000; // examples sent with each part of a translation (cost: it rides on every chunk)
const MAX_TEST_EXAMPLES = 10;

const clean = (v, n) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);

/** A set as sent by the admin screen, cleaned. Throws a 400-style error on a set that cannot be saved. */
function cleanSet(body = {}) {
  const languageCode = clean(body.languageCode, 12);
  const name = clean(body.name, 120);
  if (!languageCode) throw Object.assign(new Error('Pick the language this set is for.'), { status: 400 });
  if (!name) throw Object.assign(new Error('Give the set a name, for example "Corporate vision statements".'), { status: 400 });
  const examples = (Array.isArray(body.examples) ? body.examples : []).slice(0, MAX_EXAMPLES_PER_SET)
    .map((e) => ({
      originalLanguage: clean(e?.originalLanguage, 12) || 'en',
      original: clean(e?.original, MAX_TEXT),
      approved: clean(e?.approved, MAX_TEXT),
      note: clean(e?.note, 600),
    }))
    .filter((e) => e.original && e.approved);
  return { languageCode, name, comment: clean(body.comment, 2000), examples };
}

async function listSets() {
  const { rows } = await pool.query(
    `SELECT s.id, s."languageCode", s.name, s.comment, s."updatedAt",
            COUNT(e.id)::int AS "exampleCount", COALESCE(SUM(LENGTH(e.original) + LENGTH(e.approved)), 0)::int AS "exampleChars"
       FROM translate_style_sets s LEFT JOIN translate_style_examples e ON e."setId" = s.id
      GROUP BY s.id ORDER BY s."languageCode", s.name`);
  return rows;
}

async function getSet(id, db = pool) {
  const { rows } = await db.query('SELECT * FROM translate_style_sets WHERE id=$1', [Number(id) || 0]);
  if (!rows[0]) return null;
  const ex = await db.query('SELECT id, "originalLanguage", original, approved, note FROM translate_style_examples WHERE "setId"=$1 ORDER BY "sortOrder", id', [rows[0].id]);
  return { ...rows[0], examples: ex.rows };
}

/** Create (no id) or replace a set and all its examples, in one transaction. */
async function saveSet({ id = null, body, userId }) {
  const set = cleanSet(body);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    let setId = id ? Number(id) : null;
    if (setId) {
      const { rowCount } = await db.query(
        `UPDATE translate_style_sets SET "languageCode"=$2, name=$3, comment=$4, "updatedBy"=$5, "updatedAt"=NOW() WHERE id=$1`,
        [setId, set.languageCode, set.name, set.comment, userId]);
      if (!rowCount) { await db.query('ROLLBACK'); return null; }
      await db.query('DELETE FROM translate_style_examples WHERE "setId"=$1', [setId]);
    } else {
      const { rows } = await db.query(
        `INSERT INTO translate_style_sets ("languageCode", name, comment, "createdBy", "updatedBy") VALUES ($1,$2,$3,$4,$4) RETURNING id`,
        [set.languageCode, set.name, set.comment, userId]);
      setId = rows[0].id;
    }
    let order = 0;
    for (const e of set.examples) {
      await db.query(
        `INSERT INTO translate_style_examples ("setId", "originalLanguage", original, approved, note, "sortOrder") VALUES ($1,$2,$3,$4,$5,$6)`,
        [setId, e.originalLanguage, e.original, e.approved, e.note || null, order++]);
    }
    await db.query('COMMIT');
    return getSet(setId);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

/** The sets that can apply to a translation from `source` into `target`: the target language's first, then the source language's. */
async function setsForJob(targetLanguage, sourceLanguage) {
  const langs = [targetLanguage, sourceLanguage].filter((l) => l && l !== 'auto');
  if (!langs.length) return [];
  const { rows } = await pool.query(
    `SELECT s.id, s."languageCode", s.name, s.comment FROM translate_style_sets s
      WHERE s."languageCode" = ANY($1::text[]) AND EXISTS (SELECT 1 FROM translate_style_examples e WHERE e."setId" = s.id)
      ORDER BY (s."languageCode" = $2) DESC, s.name`, [langs, targetLanguage]);
  return rows;
}

const words = (s) => new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z]{4,}/g) || []);

/** Free fallback when the model cannot be asked: the set whose name, comment and examples share the most words with the document. */
function closestByWords(sets, setTexts, sample) {
  const doc = words(sample);
  let best = null;
  let bestScore = -1;
  for (const s of sets) {
    const w = words(`${s.name} ${s.comment || ''} ${setTexts[s.id] || ''}`);
    let score = 0;
    for (const x of w) if (doc.has(x)) score += 1;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

/**
 * Which set a job uses. `choice` is the form's: a set id, 'none', or empty for "Let Translate choose". With one set it is that one;
 * with several, a cheap model call names the closest (falls back to shared words). Returns { set, how } or null.
 */
async function chooseSet({ choice, targetLanguage, sourceLanguage, sample, modelId }) {
  if (choice === 'none') return null;
  const sets = await setsForJob(targetLanguage, sourceLanguage);
  if (!sets.length) return null;
  if (choice && /^\d+$/.test(String(choice))) {
    const picked = sets.find((s) => s.id === Number(choice));
    if (picked) return { set: picked, how: 'picked' };
    // a set picked for another language of a several-languages run: let Translate choose for this one
  }
  const own = sets.filter((s) => s.languageCode === targetLanguage);
  const pool2 = own.length ? own : sets;
  if (pool2.length === 1) return { set: pool2[0], how: 'only' };
  if (modelId) {
    try {
      const prompt = [
        'Which of these kinds of content is the document below most like? Answer with the number only, or 0 if none fits.',
        '',
        ...pool2.map((s, i) => `${i + 1}. ${s.name}${s.comment ? ` — ${s.comment.slice(0, 300)}` : ''}`),
        '',
        'Document (start):',
        String(sample || '').slice(0, 1500),
      ].join('\n');
      const res = await callModel(modelId, prompt, { maxTokens: 10, timeoutMs: 20000 });
      const n = parseInt(String(res?.text ?? res).trim().match(/\d+/)?.[0] || '', 10);
      if (n === 0) return null;
      if (n >= 1 && n <= pool2.length) return { set: pool2[n - 1], how: 'chosen' };
    } catch (err) { console.warn('[translate] house style choice failed, using shared words:', err.message); }
  }
  const { rows } = await pool.query(
    `SELECT "setId", string_agg(original || ' ' || approved, ' ') AS t FROM translate_style_examples WHERE "setId" = ANY($1::int[]) GROUP BY "setId"`,
    [pool2.map((s) => s.id)]);
  const texts = Object.fromEntries(rows.map((r) => [r.setId, r.t]));
  return { set: closestByWords(pool2, texts, sample), how: 'chosen' };
}

/**
 * The translator's brief for a set: the comment, then examples shown in the job's direction (original → approved when translating
 * into the set's language, approved → original when translating out of it), as many as fit the budget. `skipExampleId` leaves one
 * out (the test, so the translator cannot copy the answer). Returns { text, used, total }.
 */
async function buildStyleBlock({ setId, targetLanguage, sourceLanguage, skipExampleId = null }) {
  const set = await getSet(setId);
  if (!set) return { text: '', used: 0, total: 0 };
  const into = set.languageCode === targetLanguage;
  const other = into ? sourceLanguage : targetLanguage;
  const usable = set.examples.filter((e) => e.id !== skipExampleId
    && (!other || other === 'auto' || e.originalLanguage === other || !into));
  const lines = [];
  let budget = BLOCK_CHAR_BUDGET;
  let used = 0;
  for (const e of usable) {
    const from = into ? e.original : e.approved;
    const to = into ? e.approved : e.original;
    const fromLang = into ? (e.originalLanguage || 'original') : set.languageCode;
    const toLang = into ? set.languageCode : (e.originalLanguage || 'original');
    const chunk = `Example ${used + 1}${e.note ? ` (${e.note})` : ''}:\n${langName(fromLang)}: ${from}\n${langName(toLang)}: ${to}`;
    if (used && chunk.length > budget) break;
    lines.push(chunk);
    budget -= chunk.length;
    used += 1;
  }
  const header = `HOUSE STYLE for ${langName(set.languageCode)} — "${set.name}" (approved by this organisation; follow it):`;
  const text = [
    header,
    set.comment ? `How this kind of content is translated: ${set.comment}` : '',
    used ? 'Approved examples. Match their register, idiom, sentence shape and word choices; re-express ideas the way they do rather than translating word for word. Do not copy an example unless the same text appears:' : '',
    ...lines,
  ].filter(Boolean).join('\n');
  return { text, used, total: usable.length, set };
}

/** A short version for the checker: the set's name and comment, without the examples. */
function styleNoteForReview(set) {
  if (!set) return '';
  return `House style "${set.name}" for ${langName(set.languageCode)}${set.comment ? `: ${set.comment}` : ''}`.slice(0, 1200);
}

module.exports = {
  MAX_EXAMPLES_PER_SET, BLOCK_CHAR_BUDGET, MAX_TEST_EXAMPLES,
  cleanSet, listSets, getSet, saveSet, setsForJob, chooseSet, closestByWords, buildStyleBlock, styleNoteForReview,
};
