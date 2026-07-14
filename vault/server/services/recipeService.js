'use strict';

const { pool } = require('../db');
const { callModel } = require('./callModel');
const { getModelsForUser, pickTextModel } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const { webSearch, isSearchConfigured } = require('./webSearchService');
const { generateImage, getImageGenStatus } = require('./graphicsImageService');

const PANTRY_STAPLES = ['salt', 'pepper', 'olive oil'];

const SUGGEST_SYSTEM = `You are a practical home cook helping use leftovers. Pantry staples always available: salt, pepper, olive oil.
Suggest realistic dishes the user can make with their listed ingredients plus those staples. Prefer creative leftover use over shopping lists.
Return ONLY valid JSON. No markdown fences.`;

const EXPAND_SYSTEM = `You are a patient cooking instructor. Give clear, numbered steps a home cook can follow.
Also assess nutrition honestly — benefits and gaps — without medical claims.
Return ONLY valid JSON. No markdown fences.`;

const NAMED_SUGGEST_SYSTEM = `You are an expert recipe developer. For a given dish name, outline three skill levels.
Basic = supermarket-friendly ingredients, simple techniques, weeknight-friendly.
Advanced = more authentic flavours, moderate skill, some specialty items OK with accessible swaps noted.
Master = restaurant-level technique, traditional methods, ambitious but still home-kitchen achievable.
Return ONLY valid JSON. No markdown fences.`;

const NAMED_EXPAND_SYSTEM = `You are an expert cooking instructor writing a complete recipe for a named dish at a specific skill tier.
For any hard-to-find, expensive, or specialty ingredient, you MUST suggest more accessible supermarket alternatives.
Basic tier should prefer accessible ingredients throughout; Advanced and Master may use specialty items but always document swaps.
Return ONLY valid JSON. No markdown fences.`;

const NAMED_TIERS = [
  { id: 'basic', label: 'Basic', blurb: 'Supermarket-friendly, simple steps' },
  { id: 'advanced', label: 'Advanced', blurb: 'More authentic, moderate skill' },
  { id: 'master', label: 'Master', blurb: 'Restaurant-level technique' },
];

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
  if (!modelId) {
    throw new Error('No text model configured — add a chat model (not image-only) in Settings → AI & Chat');
  }
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

async function callRecipeJson(userId, modelId, prompt, { system, maxTokens = 2000, feature = 'recipes' } = {}) {
  const { text: raw } = await callRecipeModel(userId, modelId, prompt, { system, maxTokens, feature });
  let parsed = parseModelJson(raw);
  if (parsed) return parsed;

  const { text: retryRaw } = await callRecipeModel(
    userId,
    modelId,
    `The previous response was not valid JSON. Return ONLY valid JSON with no markdown fences or commentary.\n\nPrevious output:\n${String(raw || '').slice(0, 6000)}`,
    {
      system: 'You fix malformed JSON. Output valid JSON only.',
      maxTokens,
      feature: `${feature}_retry`,
    }
  );
  parsed = parseModelJson(retryRaw);
  if (!parsed) {
    console.error(`[${feature}] JSON parse failed after retry`);
    throw new Error('Could not parse recipe response — try again');
  }
  return parsed;
}

async function resolveRecipeTextModel(userId, { prefer = 'standard' } = {}) {
  const tiers = await getModelsForUser(userId);
  const modelId = pickTextModel(tiers, prefer);
  if (!modelId) {
    throw new Error('No text model configured — add a chat model (Anthropic, Gemini, or DeepSeek) in Settings → AI & Chat');
  }
  return modelId;
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

function buildNamedSuggestPrompt(name, notes = '') {
  return `Dish name: ${name.trim()}
${notes.trim() ? `Context: ${notes.trim()}\n` : ''}
Return exactly 3 tiers as JSON:
{
  "name": "${name.trim()}",
  "tiers": [
    {
      "id": "basic",
      "tierLabel": "Basic",
      "title": "Dish name — Basic",
      "summary": "One sentence on the basic approach",
      "timeMinutes": 30,
      "mealType": "lunch|dinner|etc",
      "tags": ["curry", "fast"]
    },
    {
      "id": "advanced",
      "tierLabel": "Advanced",
      "title": "...",
      "summary": "...",
      "timeMinutes": 45,
      "mealType": "...",
      "tags": []
    },
    {
      "id": "master",
      "tierLabel": "Master",
      "title": "...",
      "summary": "...",
      "timeMinutes": 90,
      "mealType": "...",
      "tags": []
    }
  ]
}`;
}

function buildNamedExpandPrompt(name, tier, recipe, notes = '') {
  const tierMeta = NAMED_TIERS.find((t) => t.id === tier) || { label: tier, blurb: '' };
  return `Dish: ${name.trim()}
Skill tier: ${tierMeta.label} — ${tierMeta.blurb}
Card summary: ${recipe?.summary || ''}
${notes.trim() ? `Context: ${notes.trim()}\n` : ''}
Assume ${PANTRY_STAPLES.join(', ')} are available.

Return JSON:
{
  "title": "...",
  "tier": "${tier}",
  "tierLabel": "${tierMeta.label}",
  "servings": 4,
  "prepMinutes": 15,
  "cookMinutes": 30,
  "ingredients": [
    { "item": "...", "amount": "...", "accessibleAlternative": "optional swap if exotic, else omit or null" }
  ],
  "ingredientAlternatives": [
    {
      "ingredient": "exotic item name",
      "alternatives": ["swap option 1 with brief note", "swap option 2"]
    }
  ],
  "steps": ["Step 1...", "Step 2..."],
  "tips": ["..."],
  "nutrition": {
    "summary": "2-3 sentences",
    "benefits": ["..."],
    "cautions": ["..."],
    "estimatedCaloriesPerServing": "rough range"
  },
  "imagePrompt": "Food photography prompt for this plated dish"
}

Include ingredientAlternatives only for specialty/exotic items. For Basic tier, prefer listing accessible ingredients directly and fewer exotic items.`;
}

async function attachLinksAndImage(userId, parsed, recipe, searchTitle) {
  let links = [];
  try {
    const searchResults = await webSearch(`${searchTitle} recipe video`, { num: 6 });
    links = searchResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      type: /youtube\.com|youtu\.be/i.test(r.url) ? 'video' : 'article',
    }));
  } catch {
    links = [];
  }

  let imageDataUrl = null;
  let imageError = null;
  try {
    const imageStatus = await getImageGenStatus(userId);
    if (imageStatus.available) {
      const imageResult = await generateDishImage(userId, {
        title: parsed.title || recipe?.title || searchTitle,
        imagePrompt: parsed.imagePrompt,
      });
      if (imageResult.ok) {
        imageDataUrl = imageResult.imageDataUrl;
      } else {
        imageError = imageResult.error || 'Could not generate dish photo';
      }
    }
  } catch (err) {
    imageError = err.message;
  }

  return { links, imageDataUrl, imageError };
}

async function suggestRecipes(userId, { ingredients, notes } = {}) {
  const text = String(ingredients || '').trim();
  if (!text) throw new Error('List at least one ingredient');

  const modelId = await resolveRecipeTextModel(userId, { prefer: 'light' });
  const parsed = await callRecipeJson(userId, modelId, buildSuggestPrompt(text, notes), {
    system: SUGGEST_SYSTEM,
    maxTokens: 2500,
    feature: 'recipes_suggest',
  });

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

  const modelId = await resolveRecipeTextModel(userId, { prefer: 'standard' });
  const parsed = await callRecipeJson(userId, modelId, buildExpandPrompt(recipe, ingredients, notes), {
    system: EXPAND_SYSTEM,
    maxTokens: 4000,
    feature: 'recipes_expand',
  });

  if (!parsed?.steps?.length) throw new Error('Could not build recipe steps — try again');

  const { links, imageDataUrl, imageError } = await attachLinksAndImage(
    userId,
    parsed,
    recipe,
    recipe.title
  );

  return {
    ...parsed,
    card: recipe,
    links,
    imageDataUrl,
    imageError,
    pantryStaples: PANTRY_STAPLES,
  };
}

async function suggestNamedRecipe(userId, { name, notes } = {}) {
  const dishName = String(name || '').trim();
  if (!dishName) throw new Error('Enter a dish name');

  const modelId = await resolveRecipeTextModel(userId, { prefer: 'light' });
  const parsed = await callRecipeJson(userId, modelId, buildNamedSuggestPrompt(dishName, notes), {
    system: NAMED_SUGGEST_SYSTEM,
    maxTokens: 2500,
    feature: 'recipes_named_suggest',
  });

  const tiers = Array.isArray(parsed?.tiers) ? parsed.tiers : [];
  const byId = Object.fromEntries(tiers.map((t) => [String(t.id || '').toLowerCase(), t]));

  return {
    name: dishName,
    notes: String(notes || '').trim(),
    tiers: NAMED_TIERS.map((meta) => {
      const t = byId[meta.id] || {};
      return {
        id: meta.id,
        tierLabel: meta.label,
        title: String(t.title || `${dishName} — ${meta.label}`).trim(),
        summary: String(t.summary || meta.blurb).trim(),
        timeMinutes: Number(t.timeMinutes) || null,
        mealType: t.mealType || 'dinner',
        tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
      };
    }),
  };
}

async function expandNamedRecipe(userId, { name, tier, recipe, notes } = {}) {
  const dishName = String(name || '').trim();
  const tierId = String(tier || recipe?.id || '').toLowerCase();
  if (!dishName) throw new Error('Dish name is required');
  if (!NAMED_TIERS.some((t) => t.id === tierId)) throw new Error('Select Basic, Advanced, or Master');

  const modelId = await resolveRecipeTextModel(userId, { prefer: 'standard' });
  const parsed = await callRecipeJson(
    userId,
    modelId,
    buildNamedExpandPrompt(dishName, tierId, recipe, notes),
    {
      system: NAMED_EXPAND_SYSTEM,
      maxTokens: 4500,
      feature: 'recipes_named_expand',
    }
  );

  if (!parsed?.steps?.length) throw new Error('Could not build recipe — try again');

  const { links, imageDataUrl, imageError } = await attachLinksAndImage(
    userId,
    parsed,
    recipe,
    `${dishName} ${tierId}`
  );

  return {
    ...parsed,
    name: dishName,
    tier: tierId,
    tierLabel: parsed.tierLabel || NAMED_TIERS.find((t) => t.id === tierId)?.label || tierId,
    card: recipe,
    links,
    imageDataUrl,
    imageError,
    ingredientAlternatives: Array.isArray(parsed.ingredientAlternatives)
      ? parsed.ingredientAlternatives.map((row) => ({
          ingredient: String(row.ingredient || '').trim(),
          alternatives: Array.isArray(row.alternatives) ? row.alternatives.map(String) : [],
        })).filter((row) => row.ingredient)
      : [],
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
  const tiers = await getModelsForUser(userId);
  const textModelStandard = pickTextModel(tiers, 'standard');
  const textModelLight = pickTextModel(tiers, 'light');
  const image = await getImageGenStatus(userId);
  const webSearchAvailable = await isSearchConfigured({ preferSerper: true });
  return {
    ai: Boolean(textModelStandard || textModelLight),
    textModel: textModelStandard || textModelLight,
    textModelStandard,
    textModelLight: tiers.light || textModelLight,
    imageGen: image.available,
    imageModel: image.model,
    imageProvider: image.provider,
    imageError: image.error,
    webSearch: webSearchAvailable,
    pantryStaples: PANTRY_STAPLES,
  };
}

module.exports = {
  PANTRY_STAPLES,
  NAMED_TIERS,
  getStatus,
  suggestRecipes,
  expandRecipe,
  suggestNamedRecipe,
  expandNamedRecipe,
  generateDishImage,
  listRecipes,
  getRecipe,
  saveRecipe,
  updateRecipe,
  deleteRecipe,
};
