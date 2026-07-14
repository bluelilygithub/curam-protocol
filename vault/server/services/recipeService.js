'use strict';

const { pool } = require('../db');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const { webSearch } = require('./webSearchService');
const { generateImage, getImageGenStatus } = require('./graphicsImageService');

const PANTRY_STAPLES = ['salt', 'pepper', 'olive oil'];

const SUGGEST_SYSTEM = `You are a practical home cook helping use leftovers. Pantry staples always available: salt, pepper, olive oil.
Suggest realistic dishes the user can make with their listed ingredients plus those staples. Prefer creative leftover use over shopping lists.
Return ONLY valid JSON. No markdown fences.`;

const EXPAND_SYSTEM = `You are a patient cooking instructor. Give clear, numbered steps a home cook can follow.
Also assess nutrition honestly — benefits and gaps — without medical claims.
Return ONLY valid JSON. No markdown fences.`;

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

function rowToRecipe(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    tags: Array.isArray(row.tags) ? row.tags : (row.tags || []),
    source: row.source,
    payload: parseJsonField(row.payload) || {},
    imageDataUrl: row.imageDataUrl,
    transaction: parseJsonField(row.transaction),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function callRecipeModel(userId, modelId, prompt, { system, maxTokens = 2000, feature = 'recipes' } = {}) {
  const result = await callModel(modelId, prompt, { system, maxTokens, returnUsage: true });
  logUsage({
    userId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature,
  });
  return result;
}

function buildSuggestPrompt(ingredients, notes = '') {
  return `Ingredients on hand:
${ingredients.trim()}

${notes.trim() ? `Extra context: ${notes.trim()}\n` : ''}Assume ${PANTRY_STAPLES.join(', ')} are always available.

Return exactly 4 distinct recipe ideas as JSON:
{
  "recipes": [
    {
      "id": "1",
      "title": "Short dish name",
      "summary": "One appetising sentence",
      "timeMinutes": 25,
      "difficulty": "easy|medium|hard",
      "mealType": "breakfast|lunch|dinner|snack",
      "tags": ["fast", "pasta"],
      "usesLeftovers": true,
      "missingExtras": ["optional item if any"]
    }
  ]
}`;
}

function buildExpandPrompt(recipe, ingredients, notes = '') {
  return `Create a full recipe for:
Title: ${recipe.title}
Summary: ${recipe.summary || ''}
Ingredients on hand: ${ingredients.trim()}
${notes.trim() ? `Context: ${notes.trim()}` : ''}
Pantry staples: ${PANTRY_STAPLES.join(', ')}

Return JSON:
{
  "title": "...",
  "servings": 2,
  "prepMinutes": 10,
  "cookMinutes": 20,
  "ingredients": [{"item":"...", "amount":"..."}],
  "steps": ["Step 1...", "Step 2..."],
  "tips": ["..."],
  "nutrition": {
    "summary": "2-3 sentences on nutritional profile",
    "benefits": ["..."],
    "cautions": ["..."],
    "estimatedCaloriesPerServing": "rough range e.g. 450-550 kcal"
  },
  "imagePrompt": "Food photography prompt for this plated dish, natural light, appetising"
}`;
}

async function suggestRecipes(userId, { ingredients, notes } = {}) {
  const text = String(ingredients || '').trim();
  if (!text) throw new Error('List at least one ingredient');

  const { standard: modelId } = await getModelsForUser(userId);
  const { text: raw } = await callRecipeModel(userId, modelId, buildSuggestPrompt(text, notes), {
    system: SUGGEST_SYSTEM,
    maxTokens: 1800,
    feature: 'recipes_suggest',
  });

  const parsed = parseModelJson(raw);
  const recipes = Array.isArray(parsed?.recipes) ? parsed.recipes.slice(0, 4) : [];
  if (!recipes.length) throw new Error('Could not generate recipe ideas — try again');

  return {
    recipes: recipes.map((r, i) => ({
      id: String(r.id || i + 1),
      title: String(r.title || `Recipe ${i + 1}`).trim(),
      summary: String(r.summary || '').trim(),
      timeMinutes: Number(r.timeMinutes) || null,
      difficulty: r.difficulty || 'medium',
      mealType: r.mealType || 'dinner',
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      usesLeftovers: Boolean(r.usesLeftovers ?? true),
      missingExtras: Array.isArray(r.missingExtras) ? r.missingExtras.map(String) : [],
    })),
    pantryStaples: PANTRY_STAPLES,
    ingredients: text,
    notes: String(notes || '').trim(),
  };
}

async function expandRecipe(userId, { recipe, ingredients, notes } = {}) {
  if (!recipe?.title) throw new Error('Recipe selection is required');

  const { standard: modelId } = await getModelsForUser(userId);
  const { text: raw } = await callRecipeModel(userId, modelId, buildExpandPrompt(recipe, ingredients, notes), {
    system: EXPAND_SYSTEM,
    maxTokens: 3500,
    feature: 'recipes_expand',
  });

  const parsed = parseModelJson(raw);
  if (!parsed?.steps?.length) throw new Error('Could not build recipe steps — try again');

  let links = [];
  try {
    const searchResults = await webSearch(`${recipe.title} recipe video`, { num: 6 });
    links = searchResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      type: /youtube\.com|youtu\.be/i.test(r.url) ? 'video' : 'article',
    }));
  } catch {
    links = [];
  }

  return {
    ...parsed,
    card: recipe,
    links,
    pantryStaples: PANTRY_STAPLES,
  };
}

async function generateDishImage(userId, { title, imagePrompt } = {}) {
  const base = String(imagePrompt || title || 'home cooked meal').trim();
  const prompt = `Professional food photography, ${base}, plated dish, shallow depth of field, natural window light, appetising, no text`;
  return generateImage(userId, {
    prompt,
    width: 768,
    height: 768,
    feature: 'recipes_image',
  });
}

async function listRecipes(userId, { tag } = {}) {
  const params = [userId];
  let sql = `SELECT * FROM recipes WHERE "userId"=$1`;
  if (tag) {
    params.push(tag);
    sql += ` AND $2 = ANY(tags)`;
  }
  sql += ` ORDER BY "updatedAt" DESC, id DESC`;
  const { rows } = await pool.query(sql, params);
  return rows.map(rowToRecipe);
}

async function getRecipe(userId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM recipes WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  return rowToRecipe(rows[0]);
}

async function saveRecipe(userId, {
  title,
  tags = [],
  source = 'generated',
  payload = {},
  imageDataUrl = null,
  transaction = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO recipes ("userId", title, tags, source, payload, "imageDataUrl", transaction)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      userId,
      String(title || 'Untitled').trim() || 'Untitled',
      Array.isArray(tags) ? tags : [],
      source || 'generated',
      JSON.stringify(payload || {}),
      imageDataUrl || null,
      transaction ? JSON.stringify(transaction) : null,
    ]
  );
  return rowToRecipe(rows[0]);
}

async function updateRecipe(userId, id, { title, tags, payload, imageDataUrl } = {}) {
  const existing = await getRecipe(userId, id);
  if (!existing) return null;

  const { rows } = await pool.query(
    `UPDATE recipes SET
       title=COALESCE($3, title),
       tags=COALESCE($4, tags),
       payload=COALESCE($5, payload),
       "imageDataUrl"=COALESCE($6, "imageDataUrl"),
       "updatedAt"=NOW()
     WHERE id=$1 AND "userId"=$2
     RETURNING *`,
    [
      id,
      userId,
      title != null ? String(title).trim() : null,
      tags != null ? tags : null,
      payload != null ? JSON.stringify(payload) : null,
      imageDataUrl !== undefined ? imageDataUrl : null,
    ]
  );
  return rowToRecipe(rows[0]);
}

async function deleteRecipe(userId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM recipes WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  return rowCount > 0;
}

async function getStatus(userId) {
  const image = await getImageGenStatus(userId);
  return {
    ai: Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY),
    imageGen: image.available,
    imageModel: image.model,
    imageProvider: image.provider,
    imageError: image.error,
    webSearch: Boolean(process.env.SEARCH_API_KEY),
    pantryStaples: PANTRY_STAPLES,
  };
}

module.exports = {
  PANTRY_STAPLES,
  getStatus,
  suggestRecipes,
  expandRecipe,
  generateDishImage,
  listRecipes,
  getRecipe,
  saveRecipe,
  updateRecipe,
  deleteRecipe,
};
