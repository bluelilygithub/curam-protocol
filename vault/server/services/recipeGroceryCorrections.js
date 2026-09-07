'use strict';

// Learned corrections for the grocery-price matcher — see docs/recipes.md
// "Correction glossary". Workspace-shared: a fix one person adds applies to
// everyone's future lookups for that ingredient term. Matching is token
// overlap, not exact substring — the AI-parsed ingredientTerm ("red kidney
// beans") won't always be a literal substring of the ingredient line
// ("kidney beans (canned)"), and exact-substring matching silently dropped
// corrections whenever the wording didn't line up exactly.
//
// Types:
//   avoid_keyword  — value: { word }              subtract score if title contains it
//   prefer_keyword — value: { word }               add score if title contains it
//   pack_override  — value: { kind, value, unit, label } — replaces resolvePackSize()

// Deliberately duplicated (not imported) from recipeGroceryService.js to
// avoid a circular require — that module requires this one.
const CORRECTION_STOPWORDS = new Set(['and', 'or', 'the', 'with', 'for', 'from', 'into', 'fresh', 'sliced', 'chopped', 'cooked', 'ground', 'canned', 'tinned', 'drained', 'rinsed']);
function correctionTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !CORRECTION_STOPWORDS.has(w));
}

const { pool } = require('../db');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { parseModelJson } = require('../utils/parseModelJson');
const { logUsage } = require('../utils/logUsage');

const VALID_TYPES = new Set(['avoid_keyword', 'prefer_keyword', 'pack_override']);

async function listCorrections() {
  const { rows } = await pool.query(
    `SELECT id, "userId", "ingredientTerm", store, type, value, note, "createdAt"
     FROM recipe_grocery_corrections ORDER BY "createdAt" DESC`
  );
  return rows;
}

/**
 * Corrections whose ingredientTerm overlaps this ingredient line by
 * significant tokens — most of the correction's key words appear in the
 * line, so "red kidney beans" matches "1 x 400g can kidney beans (canned)".
 */
function correctionsForLine(corrections, line) {
  const lineTokens = new Set(correctionTokens(line));
  if (!lineTokens.size) return [];
  return corrections.filter((c) => {
    const keyTokens = correctionTokens(c.ingredientTerm);
    if (!keyTokens.length) return false;
    const hits = keyTokens.filter((t) => lineTokens.has(t)).length;
    return hits / keyTokens.length >= 0.6;
  });
}

async function createCorrection({ userId, ingredientTerm, store, type, value, note }) {
  if (!VALID_TYPES.has(type)) throw new Error(`Unknown correction type: ${type}`);
  if (!ingredientTerm || !String(ingredientTerm).trim()) throw new Error('ingredientTerm is required');
  const { rows } = await pool.query(
    `INSERT INTO recipe_grocery_corrections ("userId", "ingredientTerm", store, type, value, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, "userId", "ingredientTerm", store, type, value, note, "createdAt"`,
    [userId, String(ingredientTerm).trim().toLowerCase(), store || null, type, JSON.stringify(value), note || null]
  );
  return rows[0];
}

async function deleteCorrection(userId, id) {
  await pool.query('DELETE FROM recipe_grocery_corrections WHERE id = $1', [id]);
}

const FEEDBACK_SYSTEM = `You turn a user's free-text correction about a grocery price match into a structured rule.
Output strict JSON only, no prose, matching exactly one of these shapes:
{"type":"avoid_keyword","ingredientTerm":"<short lowercase key, e.g. 'chicken stock cube'>","word":"<word/phrase to avoid in matched titles>"}
{"type":"prefer_keyword","ingredientTerm":"<short lowercase key>","word":"<word/phrase to prefer in matched titles>"}
{"type":"pack_override","ingredientTerm":"<short lowercase key>","kind":"mass|volume|count","value":<number>,"unit":"g|ml|each","label":"<short display label, e.g. '12 pack' or '105g (10 cubes)'>"}
"ingredientTerm" must be the generic ingredient name only (no quantity, no brand) — this is the key future matches are looked up by.
Pick pack_override when the correction is about a wrong assumed size/count/weight. Pick avoid_keyword/prefer_keyword when it's about the wrong product/variant being picked.`;

/**
 * Turn a free-text complaint about one ingredient's price result into a saved
 * correction. Returns the saved row plus the parsed shape for the caller to
 * re-price with immediately.
 */
async function learnFromFeedback({ userId, ingredient, store, note, matchedProduct }) {
  const { light } = await getModelsForUser(userId);
  const userMsg = `Ingredient line: "${ingredient}"
Store: ${store || 'both'}
Matched product shown: "${matchedProduct || 'unknown'}"
User's correction: "${note}"

Respond with the JSON only.`;

  if (!light) throw new Error('No text model configured — add a chat model in Settings → AI & Chat');
  const result = await callModel(light, userMsg, { system: FEEDBACK_SYSTEM, maxTokens: 300, returnUsage: true });
  logUsage({ userId, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'recipes-grocery-correction' });

  const parsed = parseModelJson(result.text);
  if (!parsed) throw new Error('Could not parse a correction from that note — try rephrasing more plainly.');

  const { type, ingredientTerm } = parsed;
  if (!VALID_TYPES.has(type) || !ingredientTerm) {
    throw new Error('Could not turn that into a usable correction.');
  }

  let value;
  if (type === 'pack_override') {
    value = { kind: parsed.kind, value: Number(parsed.value), unit: parsed.unit, label: parsed.label };
    if (!value.kind || !Number.isFinite(value.value) || !value.unit) {
      throw new Error('Correction was missing pack size details.');
    }
  } else {
    value = { word: String(parsed.word || '').toLowerCase().trim() };
    if (!value.word) throw new Error('Correction was missing a keyword.');
  }

  const saved = await createCorrection({ userId, ingredientTerm, store: store || null, type, value, note });
  return saved;
}

module.exports = {
  listCorrections,
  correctionsForLine,
  createCorrection,
  deleteCorrection,
  learnFromFeedback,
  VALID_TYPES,
};
