'use strict';

// The database reads the Guitar practice features share (Today's queue, the coach). Every query is filtered by the person's id.

const { pool } = require('../db');
const { countTransitions, rankTransitions } = require('./guitarTransitions');

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

module.exports = { loadTransitions, loadPracticeSongs, loadLoops, loadWeekInputs };
