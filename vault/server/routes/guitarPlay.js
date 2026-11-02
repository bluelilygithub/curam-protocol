'use strict';

// Guitar: set lists for gig mode, and ear training. Mounted at /api/guitar-play behind the Guitar feature switch.
// Every query is filtered by the caller's id; a set list can only hold the caller's own songs.

const express = require('express');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const ear = require('../services/guitarEar');
const playable = require('../services/guitarPlayable');

const router = express.Router();
const MAX_SETLISTS = 50;
const MAX_SONGS_PER_LIST = 100;

const fail = (res, err, tag) => {
  getLogger().error({ err }, `[guitar/play] ${tag}`);
  res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
};

async function listsWithSongs(userId, onlyId = null) {
  const { rows: lists } = await pool.query(
    `SELECT id, name, "updatedAt" FROM guitar_setlists WHERE "userId"=$1 ${onlyId ? 'AND id=$2' : ''} ORDER BY "updatedAt" DESC`,
    onlyId ? [userId, onlyId] : [userId]);
  if (!lists.length) return [];
  const { rows: songs } = await pool.query(
    `SELECT ss."setlistId", ss."songId", ss.position, s.title, s.artist
     FROM guitar_setlist_songs ss JOIN guitar_songs s ON s.id=ss."songId"
     WHERE ss."setlistId" = ANY($1::int[]) AND s."userId"=$2 ORDER BY ss."setlistId", ss.position`,
    [lists.map(l => l.id), userId]);
  return lists.map(l => ({ ...l, songs: songs.filter(s => s["setlistId"] === l.id).map(s => ({ songId: s.songId, title: s.title, artist: s.artist })) }));
}

/** The caller's own finished songs among `ids`, in the order given, without repeats. */
async function ownSongIds(userId, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, MAX_SONGS_PER_LIST);
  if (!wanted.length) return [];
  const { rows } = await pool.query(`SELECT id FROM guitar_songs WHERE "userId"=$1 AND id = ANY($2::int[])`, [userId, wanted]);
  const ok = new Set(rows.map(r => r.id));
  return wanted.filter(id => ok.has(id));
}

async function replaceSongs(client, setlistId, ids) {
  await client.query('DELETE FROM guitar_setlist_songs WHERE "setlistId"=$1', [setlistId]);
  for (let i = 0; i < ids.length; i++) {
    await client.query('INSERT INTO guitar_setlist_songs ("setlistId","songId",position) VALUES ($1,$2,$3)', [setlistId, ids[i], i]);
  }
}

const cleanName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

// ── Set lists ────────────────────────────────────────────────────────────────
router.get('/setlists', async (req, res) => {
  try { res.json(await listsWithSongs(req.user.id)); } catch (err) { fail(res, err, 'setlists'); }
});

router.post('/setlists', async (req, res) => {
  const client = await pool.connect();
  try {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Give the set list a name' });
    const { rows: count } = await client.query('SELECT COUNT(*) AS n FROM guitar_setlists WHERE "userId"=$1', [req.user.id]);
    if (Number(count[0].n) >= MAX_SETLISTS) return res.status(400).json({ error: `You can keep up to ${MAX_SETLISTS} set lists` });
    const ids = await ownSongIds(req.user.id, req.body?.songIds);
    await client.query('BEGIN');
    const { rows } = await client.query('INSERT INTO guitar_setlists ("userId", name) VALUES ($1,$2) RETURNING id', [req.user.id, name]);
    await replaceSongs(client, rows[0].id, ids);
    await client.query('COMMIT');
    res.status(201).json((await listsWithSongs(req.user.id, rows[0].id))[0]);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); fail(res, err, 'create setlist'); } finally { client.release(); }
});

router.put('/setlists/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Set list not found' });
    const { rows: own } = await client.query('SELECT 1 FROM guitar_setlists WHERE id=$1 AND "userId"=$2', [id, req.user.id]);
    if (!own.length) return res.status(404).json({ error: 'Set list not found' });
    const name = req.body?.name === undefined ? null : cleanName(req.body.name);
    if (name === '') return res.status(400).json({ error: 'Give the set list a name' });
    const ids = req.body?.songIds === undefined ? null : await ownSongIds(req.user.id, req.body.songIds);
    await client.query('BEGIN');
    await client.query('UPDATE guitar_setlists SET name=COALESCE($2,name), "updatedAt"=NOW() WHERE id=$1', [id, name]);
    if (ids) await replaceSongs(client, id, ids);
    await client.query('COMMIT');
    res.json((await listsWithSongs(req.user.id, id))[0]);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); fail(res, err, 'update setlist'); } finally { client.release(); }
});

router.delete('/setlists/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM guitar_setlists WHERE id=$1 AND "userId"=$2', [Number(req.params.id) || 0, req.user.id]);
    res.status(204).end();
  } catch (err) { fail(res, err, 'delete setlist'); }
});

// ── What can I play? ─────────────────────────────────────────────────────────
// The person's own songs, split by whether they only use chords the person has ticked as playable.
async function playableState(userId) {
  const { rows: events } = await pool.query(
    `SELECT s.id, s.title, s.artist, ce."chordRoot", ce."chordQuality"
     FROM guitar_songs s JOIN guitar_chord_events ce ON ce."songId"=s.id
     WHERE s."userId"=$1 AND s.status='done' ORDER BY s.id, ce."timestampSec", ce.id`, [userId]);
  const bySong = new Map();
  for (const e of events) {
    if (!bySong.has(e.id)) bySong.set(e.id, { id: e.id, title: e.title, artist: e.artist, events: [] });
    bySong.get(e.id).events.push(e);
  }
  const songs = [...bySong.values()].map(s => ({ id: s.id, title: s.title, artist: s.artist, chords: playable.songChordNames(s.events) }));
  const { rows: knownRows } = await pool.query('SELECT chord FROM guitar_known_chords WHERE "userId"=$1 ORDER BY chord', [userId]);
  const known = playable.cleanKnown(knownRows.map(r => r.chord));
  const classified = playable.classifySongs(songs, known);
  return { known, classified };
}

router.get('/my-chords', async (req, res) => {
  try {
    const { known, classified } = await playableState(req.user.id);
    res.json({
      known: [...known],
      libraryChords: [...new Set(classified.flatMap(s => s.chords))],
      songs: classified.filter(s => s.chords.length).map(s => ({ id: s.id, title: s.title, artist: s.artist, chords: s.chords, missing: s.missing, playable: s.playable })),
      suggestions: playable.suggestChords(classified),
    });
  } catch (err) { fail(res, err, 'my chords'); }
});

router.put('/my-chords', async (req, res) => {
  const client = await pool.connect();
  try {
    const raw = Array.isArray(req.body?.chords) ? req.body.chords : null;
    if (!raw) return res.status(400).json({ error: 'Send the list of chords you can play' });
    const clean = [...playable.cleanKnown(raw)].slice(0, 80);
    await client.query('BEGIN');
    await client.query('DELETE FROM guitar_known_chords WHERE "userId"=$1', [req.user.id]);
    for (const chord of clean) await client.query('INSERT INTO guitar_known_chords ("userId", chord) VALUES ($1,$2)', [req.user.id, chord]);
    await client.query('COMMIT');
    res.json({ known: clean });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); fail(res, err, 'save my chords'); } finally { client.release(); }
});

router.get('/roadmap/:songId', async (req, res) => {
  try {
    const { known, classified } = await playableState(req.user.id);
    const target = classified.find(s => s.id === Number(req.params.songId));
    if (!target) return res.status(404).json({ error: 'Song not found, or it has no chords yet' });
    res.json(playable.roadmap(target, classified, known));
  } catch (err) { fail(res, err, 'roadmap'); }
});

// ── Ear training ─────────────────────────────────────────────────────────────
// What a round is made from: the chords in the person's own songs (how many times each), and each song's key.
router.get('/ear/material', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s."keyDetected", ce."chordRoot", ce."chordQuality", COUNT(*) AS n
       FROM guitar_songs s JOIN guitar_chord_events ce ON ce."songId"=s.id
       WHERE s."userId"=$1 GROUP BY s.id, s.title, s."keyDetected", ce."chordRoot", ce."chordQuality"`, [req.user.id]);
    const songs = new Map();
    const totals = new Map();
    for (const r of rows) {
      if (!songs.has(r.id)) songs.set(r.id, { id: r.id, title: r.title, keyDetected: r.keyDetected, chords: [] });
      songs.get(r.id).chords.push({ root: r.chordRoot, quality: r.chordQuality || '', count: Number(r.n) });
      const k = `${r.chordRoot}|${r.chordQuality || ''}`;
      totals.set(k, (totals.get(k) || 0) + Number(r.n));
    }
    const chords = [...totals.entries()].map(([k, count]) => { const [root, quality] = k.split('|'); return { root, quality, count }; })
      .sort((a, b) => b.count - a.count).slice(0, 40);
    res.json({ chords, songs: [...songs.values()].filter(s => s.chords.length >= 3).slice(0, 60) });
  } catch (err) { fail(res, err, 'ear material'); }
});

router.post('/ear/sessions', async (req, res) => {
  try {
    const check = ear.checkRound(req.body || {});
    if (!check.ok) return res.status(400).json({ error: check.error });
    const v = check.value;
    const { rows } = await pool.query(
      `INSERT INTO guitar_ear_sessions ("userId", mode, correct, total, misses) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id, "playedAt"`,
      [req.user.id, v.mode, v.correct, v.total, JSON.stringify(v.misses)]);
    res.status(201).json(rows[0]);
  } catch (err) { fail(res, err, 'ear session'); }
});

router.get('/ear/summary', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mode, correct, total, misses, "playedAt" FROM guitar_ear_sessions WHERE "userId"=$1 ORDER BY "playedAt" DESC LIMIT 100`, [req.user.id]);
    res.json(ear.summarise(rows));
  } catch (err) { fail(res, err, 'ear summary'); }
});

module.exports = router;
