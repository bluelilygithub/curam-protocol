'use strict';

const express = require('express');
const {
  getStatus,
  suggestRecipes,
  expandRecipe,
  generateDishImage,
  listRecipes,
  getRecipe,
  saveRecipe,
  updateRecipe,
  deleteRecipe,
} = require('../services/recipeService');

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
    });
    res.json(result);
  } catch (err) {
    console.error('[recipes/expand]', err.message);
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

module.exports = router;
