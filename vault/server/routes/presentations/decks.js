'use strict';

const express = require('express');
const { pool } = require('../../db');
const store = require('../../services/presentations/store');
const { sendError } = require('./shared');

const router = express.Router();

router.get('/decks', async (req, res) => {
  try {
    res.json({ decks: await store.listDecks(pool, req.user.id), max: store.MAX_DECKS_PER_USER });
  } catch (err) { sendError(res, err, 'Your decks could not be listed.'); }
});

router.post('/decks', async (req, res) => {
  try {
    const deck = await store.saveDeck(pool, req.user.id, req.body || {});
    res.json({ deck });
  } catch (err) { sendError(res, err, 'That deck could not be saved.'); }
});

router.get('/decks/:id', async (req, res) => {
  try {
    const deck = await store.getDeck(pool, req.user.id, req.params.id);
    if (!deck) return res.status(404).json({ error: 'That deck was not found.' });
    return res.json({ deck });
  } catch (err) { return sendError(res, err, 'That deck could not be opened.'); }
});

router.patch('/decks/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const deck = await store.saveDeck(pool, req.user.id, { ...body, id: req.params.id });
    res.json({ deck });
  } catch (err) { sendError(res, err, 'That deck could not be saved.'); }
});

router.post('/decks/:id/duplicate', async (req, res) => {
  try {
    const deck = await store.duplicateDeck(pool, req.user.id, req.params.id);
    res.json({ deck });
  } catch (err) { sendError(res, err, 'That deck could not be duplicated.'); }
});

router.delete('/decks/:id', async (req, res) => {
  try {
    const binId = await store.deleteDeck(req.user.id, req.params.id);
    if (!binId) return res.status(404).json({ error: 'That deck was not found.' });
    return res.json({ ok: true, binId });
  } catch (err) { return sendError(res, err, 'That deck could not be deleted.'); }
});

module.exports = router;
