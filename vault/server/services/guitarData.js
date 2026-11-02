'use strict';

// The database reads the Guitar practice features share (Today's queue, the coach). Every query is filtered by the person's id.

const { pool } = require('../db');
const { countTransitions, rankTransitions, bestForPairs } = require('./guitarTransitions');
const { weekFacts } = require('./guitarCoach');
const { songChordNames } = require('./guitarPlayable');

/** The chord changes this person's songs ask for most, ranked by how much they need drilling. */
async function loadTransitions(userId, limit = 15) {
  const { rows: events } = await pool.query(
    `SELECT ce."songId", ce."chordRoot", ce."chordQuality"
     FROM guitar_chord_events ce JOIN guitar_songs s ON s.id=ce."songId"
     WHERE s."userId"=$1 ORDER BY ce."songId", ce."timestampSec", ce.id`, [userId]);
  const { rows: scores } = await pool.query(
    `SELECT "chordA", "chordB", changes, seconds, "playedAt" FROM guitar_transition_scores WHERE "userId"=$1`, [userId]);
  return rankTransitions(countTransitions(events), scores, new Date(), { limit });
}

/** Best and last score for the fixed major/minor pairs. */
async function loadPairBests(userId) {
  const { rows: scores } = await pool.query(
    `SELECT "chordA", "chordB", changes, seconds, "playedAt" FROM guitar_transition_scores WHERE "userId"=$1`, [userId]);
  return bestForPairs(scores);
}

/** Finished songs with where each one stands (status, last played). */
async function loadPracticeSongs(userId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.title, s.artist, s."createdAt", us."learnStatus", us."rustyAfterDays", us."lastPracticedAt"
     FROM guitar_songs s LEFT JOIN guitar_user_songs us ON us."songId"=s.id AND us."userId"=$1
     WHERE s."userId"=$1 AND s.status='done'`, [userId]);
  return rows;
}

async function loadLoops(userId) {
  const { rows } = await pool.query(
    `SELECT l.id, l.name, us."songId", l."startTimeSec", l."endTimeSec"
     FROM guitar_user_song_loops l JOIN guitar_user_songs us ON us.id=l."userSongId" WHERE us."userId"=$1`, [userId]);
  return rows;
}

/** What the weekly review reads: the last 14 days of practice, and loop and drill history. */
async function loadWeekInputs(userId) {
  const [sessions, loopRuns, scores, songs] = await Promise.all([
    pool.query(
      `SELECT p."songId", s.title, p.minutes, p.confidence, p."playedAt" FROM guitar_practice_sessions p
       JOIN guitar_songs s ON s.id=p."songId" WHERE p."userId"=$1 AND p."playedAt" > NOW() - INTERVAL '14 days'`, [userId]),
    pool.query(
      `SELECT r."loopId", l.name AS "loopName", s.title, r."speedPct", r.bpm, r."playedAt"
       FROM guitar_loop_runs r JOIN guitar_user_song_loops l ON l.id=r."loopId" JOIN guitar_songs s ON s.id=r."songId"
       WHERE r."userId"=$1 AND r."playedAt" > NOW() - INTERVAL '120 days'`, [userId]),
    pool.query(
      `SELECT "chordA", "chordB", changes, seconds, "playedAt" FROM guitar_transition_scores
       WHERE "userId"=$1 AND "playedAt" > NOW() - INTERVAL '120 days'`, [userId]),
    loadPracticeSongs(userId),
  ]);
  return { sessions: sessions.rows, loopRuns: loopRuns.rows, scores: scores.rows, songs };
}

/** Everything milestones and tips are worked out from. All numbers come from the person's own practice, chords and scores. */
async function loadMilestoneFacts(userId, now = new Date()) {
  const [agg, ready, known, events, drills, loopBest, earBest, week] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(minutes),0) AS minutes, MIN("playedAt") AS first, MAX("playedAt") AS last
       FROM guitar_practice_sessions WHERE "userId"=$1`, [userId]),
    pool.query(
      `SELECT COUNT(*) AS n FROM guitar_user_songs us JOIN guitar_songs s ON s.id=us."songId"
       WHERE us."userId"=$1 AND s."userId"=$1 AND us."learnStatus"='ready'`, [userId]),
    pool.query('SELECT chord FROM guitar_known_chords WHERE "userId"=$1', [userId]),
    pool.query(
      `SELECT s.id, ce."chordRoot", ce."chordQuality" FROM guitar_songs s JOIN guitar_chord_events ce ON ce."songId"=s.id
       WHERE s."userId"=$1 AND s.status='done' ORDER BY s.id, ce."timestampSec", ce.id`, [userId]),
    pool.query(
      `SELECT COUNT(*) AS n, COALESCE(MAX(changes * 60.0 / seconds),0) AS best FROM guitar_transition_scores WHERE "userId"=$1`, [userId]),
    pool.query('SELECT COALESCE(MAX("speedPct"),0) AS best FROM guitar_loop_runs WHERE "userId"=$1', [userId]),
    pool.query('SELECT COALESCE(MAX(correct * 100.0 / total),0) AS best FROM guitar_ear_sessions WHERE "userId"=$1 AND total >= 10', [userId]),
    loadWeekInputs(userId),
  ]);
  const bySong = new Map();
  for (const e of events.rows) { if (!bySong.has(e.id)) bySong.set(e.id, []); bySong.get(e.id).push(e); }
  const libraryChords = [...new Set([...bySong.values()].flatMap(songChordNames))];

  const week14 = week.sessions.filter(s => now.getTime() - new Date(s.playedAt).getTime() < 14 * 86400000);
  const timed = week14.filter(s => s.minutes != null && s.minutes > 0);
  const wf = weekFacts(week, now);
  return {
    practiceCount: Number(agg.rows[0].n), practiceMinutes: Number(agg.rows[0].minutes),
    firstPracticeAt: agg.rows[0].first, lastPracticeAt: agg.rows[0].last,
    recentAvgMinutes: timed.length ? timed.reduce((a, s) => a + s.minutes, 0) / timed.length : null,
    recentLowConfidence: week14.some(s => s.confidence != null && s.confidence <= 2),
    readySongs: Number(ready.rows[0].n), knownChords: known.rows.map(r => r.chord), libraryChords,
    drillTries: Number(drills.rows[0].n), bestDrillRate: Math.round(Number(drills.rows[0].best)),
    bestLoopSpeed: Number(loopBest.rows[0].best), bestEarPct: Math.round(Number(earBest.rows[0].best)),
    rustySongs: wf.rusty.length, stalled: wf.stalled.length,
  };
}

module.exports = { loadPairBests, loadTransitions, loadPracticeSongs, loadLoops, loadWeekInputs, loadMilestoneFacts };
