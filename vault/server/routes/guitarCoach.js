'use strict';

// The Guitar coach: a weekly review, a practice session built to the minute, and an explanation of one song. Mounted at
// /api/guitar-coach behind the Guitar feature switch and the AI rate limit. The numbers and the plan come from the person's own data
// in code; a model only writes the wording and is checked (services/guitarCoach.js, guitarCoachAi.js).

const express = require('express');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const coach = require('../services/guitarCoach');
const ai = require('../services/guitarCoachAi');
const data = require('../services/guitarData');

const router = express.Router();

router.get('/week', async (req, res) => {
  try {
    const facts = coach.weekFacts(await data.loadWeekInputs(req.user.id));
    const review = await ai.weeklyReview(req.user.id, facts);
    res.json({ facts, review: review.text, source: review.source });
  } catch (err) {
    getLogger().error({ err }, '[guitar/coach] week');
    res.status(500).json({ error: 'The weekly review could not be made just now. Try again in a moment.' });
  }
});

router.post('/session', async (req, res) => {
  try {
    const { minutes, focus, note } = req.body || {};
    const mins = Number(minutes);
    if (!(Number.isInteger(mins) && mins >= 5 && mins <= 120)) return res.status(400).json({ error: 'Minutes must be a whole number from 5 to 120' });
    const chosen = (Array.isArray(focus) ? focus : []).filter(f => coach.FOCUS.includes(f));
    const text = typeof note === 'string' ? note.slice(0, 120) : '';
    const wanted = [...new Set([...chosen, ...coach.focusFromText(text)])];
    const [songs, loops, transitions] = await Promise.all([
      data.loadPracticeSongs(req.user.id), data.loadLoops(req.user.id), data.loadTransitions(req.user.id),
    ]);
    const plan = coach.buildSession({ minutes: mins, focus: wanted, songs, loops, transitions });
    const words = await ai.sessionWords(req.user.id, plan, text);
    res.json({
      minutes: plan.minutes, planned: plan.planned, short: plan.short, focus: plan.focus, intro: words.intro, source: words.source,
      blocks: plan.blocks.map((b, i) => ({ ...b, tip: words.tips[i] || '' })),
    });
  } catch (err) {
    getLogger().error({ err }, '[guitar/coach] session');
    res.status(500).json({ error: 'The session could not be built just now. Try again in a moment.' });
  }
});

router.post('/explain', async (req, res) => {
  try {
    const songId = Number(req.body?.songId);
    if (!Number.isInteger(songId)) return res.status(400).json({ error: 'Choose a song first' });
    const { rows: song } = await pool.query(
      `SELECT title, artist, bpm, "keyDetected" FROM guitar_songs WHERE id=$1 AND "userId"=$2`, [songId, req.user.id]);
    if (!song.length) return res.status(404).json({ error: 'Song not found' });
    const { rows: chords } = await pool.query(
      `SELECT "chordRoot", "chordQuality" FROM guitar_chord_events WHERE "songId"=$1 ORDER BY "timestampSec", id LIMIT 400`, [songId]);
    if (chords.length < 3) return res.status(400).json({ error: 'This song needs a few chords on its chart first' });
    const facts = coach.explainFacts(song[0], chords, req.body?.analysis && typeof req.body.analysis === 'object' ? req.body.analysis : {});
    const explanation = await ai.explainSong(req.user.id, facts);
    if (!explanation) return res.status(503).json({ error: 'The coach could not explain this song just now. Check that an AI model is set up, or try again.' });
    res.json({ ...explanation, chords: facts.chords });
  } catch (err) {
    getLogger().error({ err }, '[guitar/coach] explain');
    res.status(500).json({ error: 'The coach could not explain this song just now. Try again in a moment.' });
  }
});

module.exports = router;
