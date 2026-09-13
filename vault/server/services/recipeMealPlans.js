'use strict';

const { pool } = require('../db');
const { priceIngredients } = require('./recipeGroceryService');
const { scaleIngredients, mergeIngredientLists } = require('./recipeQuantity');

function planRowToPlan(row, items) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: (items || []).map((it) => ({
      id: it.id,
      recipeId: it.recipeId,
      title: it.title,
      servings: it.servings,
      position: it.position,
    })),
  };
}

async function listMealPlans(userId) {
  const { rows } = await pool.query(
    `SELECT p.*, COUNT(i.id)::int AS "itemCount"
     FROM recipe_meal_plans p
     LEFT JOIN recipe_meal_plan_items i ON i."planId" = p.id
     WHERE p."userId"=$1
     GROUP BY p.id
     ORDER BY p."updatedAt" DESC`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    itemCount: row.itemCount,
  }));
}

async function createMealPlan(userId, { title, items } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw new Error('Select at least one recipe for the plan');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: planRows } = await client.query(
      `INSERT INTO recipe_meal_plans ("userId", title) VALUES ($1,$2) RETURNING *`,
      [userId, String(title || 'Untitled plan').trim() || 'Untitled plan']
    );
    const plan = planRows[0];

    const itemRows = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const recipeId = it?.recipeId != null ? Number(it.recipeId) : null;
      let itemTitle = String(it?.title || '').trim();

      if (recipeId) {
        const { rows } = await client.query(
          `SELECT title FROM recipes WHERE id=$1 AND "userId"=$2`,
          [recipeId, userId]
        );
        if (rows[0]) itemTitle = itemTitle || rows[0].title;
      }
      if (!itemTitle) itemTitle = 'Untitled';

      const { rows: inserted } = await client.query(
        `INSERT INTO recipe_meal_plan_items ("planId", "recipeId", title, servings, "position")
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [plan.id, recipeId, itemTitle, it?.servings != null ? Number(it.servings) : null, i]
      );
      itemRows.push(inserted[0]);
    }

    await client.query('COMMIT');
    return planRowToPlan(plan, itemRows);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getMealPlan(userId, id) {
  const { rows: planRows } = await pool.query(
    `SELECT * FROM recipe_meal_plans WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  if (!planRows[0]) return null;
  const { rows: itemRows } = await pool.query(
    `SELECT * FROM recipe_meal_plan_items WHERE "planId"=$1 ORDER BY "position" ASC`,
    [id]
  );
  return planRowToPlan(planRows[0], itemRows);
}

async function deleteMealPlan(userId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM recipe_meal_plans WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  return rowCount > 0;
}

async function deleteMealPlanItem(userId, planId, itemId) {
  const { rows } = await pool.query(
    `SELECT p.id FROM recipe_meal_plans p WHERE p.id=$1 AND p."userId"=$2`,
    [planId, userId]
  );
  if (!rows[0]) return false;
  const { rowCount } = await pool.query(
    `DELETE FROM recipe_meal_plan_items WHERE id=$1 AND "planId"=$2`,
    [itemId, planId]
  );
  return rowCount > 0;
}

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

/**
 * Aggregates every recipe's ingredient list in the plan (scaled by each
 * item's chosen servings vs. the saved recipe's original servings, when
 * both are known), merges duplicate ingredients across recipes, then runs
 * the existing priceIngredients() pipeline ONCE on the merged list — reuses
 * the shared grocery-pricing pipeline rather than forking a second one.
 */
async function priceMealPlan(userId, planId) {
  const plan = await getMealPlan(userId, planId);
  if (!plan) throw new Error('Meal plan not found');
  if (!plan.items.length) throw new Error('This plan has no recipes yet');

  const recipeIds = plan.items.map((it) => it.recipeId).filter((id) => id != null);
  let recipesById = {};
  if (recipeIds.length) {
    const { rows } = await pool.query(
      `SELECT id, title, payload FROM recipes WHERE id = ANY($1) AND "userId"=$2`,
      [recipeIds, userId]
    );
    recipesById = Object.fromEntries(rows.map((r) => [r.id, r]));
  }

  const perRecipeIngredientLists = [];
  const missingRecipes = [];
  for (const item of plan.items) {
    const recipeRow = item.recipeId != null ? recipesById[item.recipeId] : null;
    if (!recipeRow) {
      missingRecipes.push(item.title);
      continue;
    }
    const payload = parseJsonField(recipeRow.payload) || {};
    const originalIngredients = Array.isArray(payload.ingredients) ? payload.ingredients : [];
    if (!originalIngredients.length) continue;

    const originalServings = Number(payload.servings) || null;
    const chosenServings = Number(item.servings) || originalServings;
    const factor = originalServings && chosenServings ? chosenServings / originalServings : 1;

    perRecipeIngredientLists.push(scaleIngredients(originalIngredients, factor));
  }

  if (!perRecipeIngredientLists.length) {
    throw new Error('None of the recipes in this plan have saved ingredients to price');
  }

  const mergedIngredients = mergeIngredientLists(perRecipeIngredientLists);
  const ingredientLines = mergedIngredients
    .map((ing) => (ing.amount ? `${ing.amount} ${ing.item}` : ing.item))
    .join('\n');

  const priced = await priceIngredients(userId, {
    ingredients: ingredientLines,
    recipeIngredients: mergedIngredients,
  });

  return {
    ...priced,
    plan: { id: plan.id, title: plan.title, items: plan.items },
    mergedIngredients,
    missingRecipes,
  };
}

module.exports = {
  listMealPlans,
  createMealPlan,
  getMealPlan,
  deleteMealPlan,
  deleteMealPlanItem,
  priceMealPlan,
};
