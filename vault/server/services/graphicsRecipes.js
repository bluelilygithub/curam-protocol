'use strict';

// Saved Graphics recipes: a named list of editing steps (the same steps as the Pipeline tool) plus an optional output format.
// A recipe holds settings only, never a picture; the Brand Kit logo is used by reference (the 'logo' step). Table graphics_recipes.

const MAX_RECIPES_PER_USER = 50;
const NAME_MAX = 80;
const OUT_FORMATS = ['png', 'jpg', 'webp', 'avif'];
const NUMBER_KEYS = ['value', 'width', 'height', 'opacity', 'scale', 'fontSize'];
const TEXT_KEYS = ['color', 'fit', 'aspect', 'strategy', 'text', 'position'];

class RecipeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** Checks and trims what the browser sent. Returns { name, steps, outFormat, outQuality } or throws RecipeError. */
function sanitizeRecipe(input, { ops, maxSteps }) {
  const name = String(input?.name || '').trim().slice(0, NAME_MAX);
  if (!name) throw new RecipeError('Give the recipe a name');
  const raw = Array.isArray(input?.steps) ? input.steps : [];
  if (!raw.length) throw new RecipeError('Add at least one step before saving');
  if (raw.length > maxSteps) throw new RecipeError(`A recipe can have at most ${maxSteps} steps`);
  const steps = raw.map((s, i) => {
    const op = String(s?.op || '');
    if (!ops.includes(op)) throw new RecipeError(`Step ${i + 1} is not a step Graphics knows`);
    const out = { op };
    for (const k of NUMBER_KEYS) if (s[k] !== undefined && s[k] !== null && s[k] !== '' && Number.isFinite(Number(s[k]))) out[k] = Number(s[k]);
    for (const k of TEXT_KEYS) if (typeof s[k] === 'string' && s[k].trim()) out[k] = s[k].trim().slice(0, 200);
    return out;
  });
  const fmt = String(input?.outFormat || '').toLowerCase();
  const outFormat = OUT_FORMATS.includes(fmt) ? fmt : null;
  const q = Number(input?.outQuality);
  const outQuality = outFormat && outFormat !== 'png' && Number.isFinite(q) ? Math.min(100, Math.max(1, Math.round(q))) : null;
  return { name, steps, outFormat, outQuality };
}

const toApi = (r) => ({ id: r.id, name: r.name, steps: r.steps, outFormat: r.outFormat, outQuality: r.outQuality, updatedAt: r.updatedAt });

async function listRecipes(db, userId) {
  const { rows } = await db.query(`SELECT * FROM graphics_recipes WHERE "userId" = $1 ORDER BY "updatedAt" DESC, id DESC`, [userId]);
  return rows.map(toApi);
}

/** One recipe, only if it belongs to this person; null otherwise. */
async function getRecipe(db, userId, id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const { rows } = await db.query(`SELECT * FROM graphics_recipes WHERE id = $1 AND "userId" = $2`, [n, userId]);
  return rows[0] ? toApi(rows[0]) : null;
}

/** Create (no id) or update (id) a recipe. A name that already exists is replaced when saving without an id would collide: same name = update it. */
async function saveRecipe(db, userId, input, rules) {
  const r = sanitizeRecipe(input, rules);
  const id = input?.id != null ? Number(input.id) : null;
  if (id != null && Number.isInteger(id)) {
    const { rows } = await db.query(
      `UPDATE graphics_recipes SET name=$3, steps=$4::jsonb, "outFormat"=$5, "outQuality"=$6, "updatedAt"=NOW() WHERE id=$1 AND "userId"=$2 RETURNING *`,
      [id, userId, r.name, JSON.stringify(r.steps), r.outFormat, r.outQuality]);
    if (!rows[0]) throw new RecipeError('That recipe was not found', 404);
    return toApi(rows[0]);
  }
  const same = await db.query(`SELECT id FROM graphics_recipes WHERE "userId" = $1 AND LOWER(name) = LOWER($2)`, [userId, r.name]);
  if (same.rows[0]) return saveRecipe(db, userId, { ...input, id: same.rows[0].id }, rules);
  const count = await db.query(`SELECT COUNT(*) AS n FROM graphics_recipes WHERE "userId" = $1`, [userId]);
  if (Number(count.rows[0].n) >= MAX_RECIPES_PER_USER) throw new RecipeError(`You can keep up to ${MAX_RECIPES_PER_USER} recipes. Delete one first.`, 409);
  const { rows } = await db.query(
    `INSERT INTO graphics_recipes ("userId", name, steps, "outFormat", "outQuality") VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING *`,
    [userId, r.name, JSON.stringify(r.steps), r.outFormat, r.outQuality]);
  return toApi(rows[0]);
}

module.exports = { sanitizeRecipe, listRecipes, getRecipe, saveRecipe, RecipeError, MAX_RECIPES_PER_USER, OUT_FORMATS };
