'use strict';

// Earlier versions of a note, so autosave, an AI tidy-up or a slip can always be undone. (docs/notes.md, "Earlier versions".)
//
// When a note is saved with a change, the text it had BEFORE can be kept as a version. Keeping one for every autosave would be hundreds an hour, so a
// version is kept when:
//   - the note has none yet, or
//   - the last kept version is at least MIN_GAP_MS older than the state being replaced (so about one version per 5 minutes of editing), or
//   - the change is big: the text got shorter or longer by BIG_CHANGE_MIN characters and by BIG_CHANGE_RATIO of its length (a section deleted, a
//     whole note pasted over, a tidy-up that rewrote everything), or
//   - the save says why it is special (`reason`: an AI change, a restore).
// At most MAX_VERSIONS are kept per note (the newest); older ones are removed. A restore keeps the current text as a version first, so a restore
// can itself be undone. Every query is by the person's own id. The rules are pure (`shouldKeep`) and unit-tested: node server/services/noteVersions.test.js

const MIN_GAP_MS = 5 * 60 * 1000;
const BIG_CHANGE_MIN = 200;
const BIG_CHANGE_RATIO = 0.3;
const MAX_VERSIONS = 100;
const REASONS = ['edit', 'ai', 'restore'];

/**
 * Should the state being replaced be kept as a version?
 *   prev        { title, body, savedAt }  the stored note before this save
 *   next        { title, body }           what is being saved
 *   lastKeptAt  when the newest kept version was saved (a Date), or null when there is none
 *   reason      'edit' | 'ai' | 'restore'
 */
function shouldKeep({ prev, next, lastKeptAt, reason = 'edit' }) {
  const before = String(prev.body ?? '');
  const after = String(next.body ?? '');
  if (before === after && String(prev.title ?? '') === String(next.title ?? '')) return false; // nothing changed
  if (!before.trim()) return false;                                                              // a note with no text yet has nothing to go back to
  if (reason === 'ai' || reason === 'restore') return true;
  if (!lastKeptAt) return true;
  if (new Date(prev.savedAt).getTime() - new Date(lastKeptAt).getTime() >= MIN_GAP_MS) return true;
  const delta = Math.abs(after.length - before.length);
  return delta >= BIG_CHANGE_MIN && delta >= before.length * BIG_CHANGE_RATIO;
}

const cleanReason = (r) => (REASONS.includes(r) ? r : 'edit');

/** A line for the list: the first words of the text. */
const previewOf = (body) => String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);

// ---- the database side ----

/** Called by the save route with the stored note as it was and what is being saved. Never throws: the note is already saved. */
async function keepIfNeeded(pool, userId, prev, next, { reason = 'edit', log } = {}) {
  try {
    const { rows: [last] } = await pool.query('SELECT saved_at FROM note_versions WHERE note_id=$1 AND user_id=$2 ORDER BY saved_at DESC, id DESC LIMIT 1', [prev.id, userId]);
    if (!shouldKeep({ prev: { title: prev.title, body: prev.body, savedAt: prev.updated_at }, next, lastKeptAt: last?.saved_at || null, reason })) return false;
    await pool.query(
      'INSERT INTO note_versions (note_id, user_id, title, body, saved_at, reason) VALUES ($1, $2, $3, $4, $5, $6)',
      [prev.id, userId, prev.title, prev.body, prev.updated_at, cleanReason(reason)]
    );
    await pool.query(
      `DELETE FROM note_versions WHERE note_id=$1 AND user_id=$2 AND id NOT IN
         (SELECT id FROM note_versions WHERE note_id=$1 AND user_id=$2 ORDER BY saved_at DESC, id DESC LIMIT $3)`,
      [prev.id, userId, MAX_VERSIONS]
    );
    return true;
  } catch (err) {
    log?.error?.({ err }, '[note versions keep]');
    return false;
  }
}

/** The versions of a note, newest first, without their text (a short preview and the length instead). */
async function list(pool, userId, noteId) {
  const { rows } = await pool.query(
    'SELECT id, title, saved_at, reason, char_length(body) AS chars, left(body, 400) AS head FROM note_versions WHERE note_id=$1 AND user_id=$2 ORDER BY saved_at DESC, id DESC',
    [noteId, userId]
  );
  return rows.map((r) => ({ id: r.id, title: r.title, saved_at: r.saved_at, reason: r.reason, chars: r.chars, preview: previewOf(r.head) }));
}

/** One version in full, or null. */
async function get(pool, userId, noteId, versionId) {
  const { rows: [v] } = await pool.query('SELECT id, title, body, saved_at, reason FROM note_versions WHERE id=$1 AND note_id=$2 AND user_id=$3', [versionId, noteId, userId]);
  return v || null;
}

module.exports = { MIN_GAP_MS, BIG_CHANGE_MIN, BIG_CHANGE_RATIO, MAX_VERSIONS, REASONS, shouldKeep, cleanReason, previewOf, keepIfNeeded, list, get };
