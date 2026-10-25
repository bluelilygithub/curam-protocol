'use strict';

// Saved recipes for Graphics: GET /recipes, POST /recipes (create or update by id or same name), DELETE /recipes/:id (into the shared
// recycle bin). Running a recipe is the Pipeline route (one picture) or Batch with op "pipeline" and a recipeId (many). See
// services/graphicsRecipes.js and docs/graphics-tools.md.

const express = require('express');
const router = express.Router();
const { pool } = require('./shared');
const { PIPELINE_OPS, PIPELINE_MAX_STEPS } = require('./enhance');
const recipes = require('../../services/graphicsRecipes');

const RULES = { ops: PIPELINE_OPS, maxSteps: PIPELINE_MAX_STEPS };
const BIN_TYPE = 'graphics-recipe';

function fail(res, err) {
  res.status(err.status || 500).json({ error: err.message || 'Recipes failed' });
}

router.get('/recipes', async (req, res) => {
  try {
    res.json({ recipes: await recipes.listRecipes(pool, req.user.id), max: recipes.MAX_RECIPES_PER_USER });
  } catch (err) { fail(res, err); }
});

router.post('/recipes', async (req, res) => {
  try {
    res.json({ ok: true, recipe: await recipes.saveRecipe(pool, req.user.id, req.body || {}, RULES) });
  } catch (err) { fail(res, err); }
});

router.delete('/recipes/:id', async (req, res) => {
  const bin = require('../../services/recycleBin');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(`SELECT * FROM graphics_recipes WHERE id = $1 AND "userId" = $2 FOR UPDATE`, [Number(req.params.id) || 0, req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'That recipe was not found' }); }
    const r = rows[0];
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: BIN_TYPE, id: r.id, title: r.name,
      detail: `${r.steps.length} step${r.steps.length === 1 ? '' : 's'}`,
      payload: { recipe: r },
    });
    await db.query(`DELETE FROM graphics_recipes WHERE id = $1 AND "userId" = $2`, [r.id, req.user.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { db.release(); }
});

module.exports = router;
