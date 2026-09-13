'use strict';

const express = require('express');
const {
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
} = require('../services/recipeService');
const { priceIngredients } = require('../services/recipeGroceryService');
const {
  listCorrections,
  deleteCorrection,
  learnFromFeedback,
} = require('../services/recipeGroceryCorrections');
const {
  listMealPlans,
  createMealPlan,
  getMealPlan,
  deleteMealPlan,
  deleteMealPlanItem,
  priceMealPlan,
} = require('../services/recipeMealPlans');

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    res.json(await getStatus(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/suggest', async (req, res) => {
  try {
    const result = await suggestRecipes(req.user.id, {
      ingredients: req.body?.ingredients,
      notes: req.body?.notes,
      restrictions: req.body?.restrictions,
    });
    res.json(result);
  } catch (err) {
    console.error('[recipes/suggest]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/expand', async (req, res) => {
  try {
    const result = await expandRecipe(req.user.id, {
      recipe: req.body?.recipe,
      ingredients: req.body?.ingredients,
      notes: req.body?.notes,
      restrictions: req.body?.restrictions,
    });
    res.json(result);
  } catch (err) {
    console.error('[recipes/expand]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/named/suggest', async (req, res) => {
  try {
    const result = await suggestNamedRecipe(req.user.id, {
      name: req.body?.name,
      notes: req.body?.notes,
      restrictions: req.body?.restrictions,
    });
    res.json(result);
  } catch (err) {
    console.error('[recipes/named/suggest]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/named/expand', async (req, res) => {
  try {
    const result = await expandNamedRecipe(req.user.id, {
      name: req.body?.name,
      tier: req.body?.tier,
      recipe: req.body?.recipe,
      notes: req.body?.notes,
      restrictions: req.body?.restrictions,
    });
    res.json(result);
  } catch (err) {
    console.error('[recipes/named/expand]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/grocery/price', async (req, res) => {
  try {
    const result = await priceIngredients(req.user.id, {
      ingredients: req.body?.ingredients,
      recipeTitle: req.body?.recipeTitle,
      servings: req.body?.servings,
      recipeIngredients: req.body?.recipeIngredients,
    });
    res.json(result);
  } catch (err) {
    console.error('[recipes/grocery/price]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Correction glossary — learned fixes for the grocery-price matcher.
// See docs/recipes.md "Correction glossary".
router.get('/grocery/corrections', async (req, res) => {
  try {
    res.json({ corrections: await listCorrections() });
  } catch (err) {
    console.error('[recipes/grocery/corrections]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/grocery/feedback', async (req, res) => {
  try {
    const { ingredient, store, note, matchedProduct } = req.body || {};
    if (!ingredient || !note) {
      return res.status(400).json({ error: 'ingredient and note are required' });
    }
    const correction = await learnFromFeedback({ userId: req.user.id, ingredient, store, note, matchedProduct });
    const recalced = await priceIngredients(req.user.id, { ingredients: ingredient });
    res.json({ correction, item: recalced.items?.[0] || null });
  } catch (err) {
    console.error('[recipes/grocery/feedback]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/grocery/corrections/:id', async (req, res) => {
  try {
    await deleteCorrection(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[recipes/grocery/corrections delete]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/image', async (req, res) => {
  try {
    const result = await generateDishImage(req.user.id, {
      title: req.body?.title,
      imagePrompt: req.body?.imagePrompt,
    });
    if (!result.ok) return res.status(503).json(result);
    res.json(result);
  } catch (err) {
    console.error('[recipes/image]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/library', async (req, res) => {
  try {
    const items = await listRecipes(req.user.id, { tag: req.query?.tag || null });
    res.json(items);
  } catch (err) {
    console.error('[recipes/library GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/library', async (req, res) => {
  try {
    const item = await saveRecipe(req.user.id, {
      title: req.body?.title,
      tags: req.body?.tags,
      source: req.body?.source,
      payload: req.body?.payload,
      imageDataUrl: req.body?.imageDataUrl,
      transaction: req.body?.transaction,
    });
    res.status(201).json(item);
  } catch (err) {
    console.error('[recipes/library POST]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/library/:id', async (req, res) => {
  try {
    const item = await getRecipe(req.user.id, Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    console.error('[recipes/library/:id GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/library/:id', async (req, res) => {
  try {
    const item = await updateRecipe(req.user.id, Number(req.params.id), {
      title: req.body?.title,
      tags: req.body?.tags,
      payload: req.body?.payload,
      imageDataUrl: req.body?.imageDataUrl,
    });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    console.error('[recipes/library PATCH]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/library/:id', async (req, res) => {
  try {
    const ok = await deleteRecipe(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[recipes/library DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Meal plans — aggregate several saved recipes into one weekly shop.
// See docs/recipes.md "Meal plans".
router.get('/meal-plans', async (req, res) => {
  try {
    res.json(await listMealPlans(req.user.id));
  } catch (err) {
    console.error('[recipes/meal-plans GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/meal-plans', async (req, res) => {
  try {
    const plan = await createMealPlan(req.user.id, {
      title: req.body?.title,
      items: req.body?.items,
    });
    res.status(201).json(plan);
  } catch (err) {
    console.error('[recipes/meal-plans POST]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/meal-plans/:id', async (req, res) => {
  try {
    const plan = await getMealPlan(req.user.id, Number(req.params.id));
    if (!plan) return res.status(404).json({ error: 'Not found' });
    res.json(plan);
  } catch (err) {
    console.error('[recipes/meal-plans/:id GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/meal-plans/:id', async (req, res) => {
  try {
    const ok = await deleteMealPlan(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[recipes/meal-plans/:id DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/meal-plans/:id/items/:itemId', async (req, res) => {
  try {
    const ok = await deleteMealPlanItem(req.user.id, Number(req.params.id), Number(req.params.itemId));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[recipes/meal-plans/:id/items/:itemId DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/meal-plans/:id/price', async (req, res) => {
  try {
    const result = await priceMealPlan(req.user.id, Number(req.params.id));
    res.json(result);
  } catch (err) {
    console.error('[recipes/meal-plans/:id/price]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
