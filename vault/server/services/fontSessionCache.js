'use strict';

/**
 * In-memory cache of fetch+frozen base font bytes, keyed by session id —
 * so the debounced live-preview endpoint never re-fetches from GitHub.
 * Fetch+freeze (network I/O, ~3-4s) happens once on font selection;
 * every subsequent slider/kerning tweak reuses these bytes and only pays
 * for transform+export (~0.2-0.5s).
 *
 * Deliberately simple (a Map, not Redis/a DB): this is a single-server
 * Railway deployment, and losing the cache on restart is an explicit
 * non-goal to solve — a preview call against a missing/expired session
 * returns a typed error (SESSION_EXPIRED) the frontend re-fetches from,
 * rather than erroring hard.
 */

const crypto = require('crypto');

const TTL_MS = Number(process.env.FONTS_SESSION_TTL_MS || 45 * 60 * 1000); // 45 min default, within the 30-60 min range asked for
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // periodic cleanup so idle sessions don't sit in memory until next access

const sessions = new Map(); // id -> { fontBuffer, meta, lastAccessed }

function createSession({ fontBuffer, meta }) {
  const id = crypto.randomUUID();
  sessions.set(id, { fontBuffer, meta, lastAccessed: Date.now() });
  return id;
}

/** Returns { fontBuffer, meta } or null if missing/expired — never throws. */
function getSession(id) {
  const entry = sessions.get(id);
  if (!entry) return null;
  if (Date.now() - entry.lastAccessed > TTL_MS) {
    sessions.delete(id);
    return null;
  }
  entry.lastAccessed = Date.now(); // touch on access — sliding idle window, not a fixed lifetime
  return entry;
}

function deleteSession(id) {
  sessions.delete(id);
}

function sweepExpired() {
  const now = Date.now();
  for (const [id, entry] of sessions.entries()) {
    if (now - entry.lastAccessed > TTL_MS) sessions.delete(id);
  }
}

let sweepTimer = null;
function startSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.(); // don't keep the process alive just for this
}

module.exports = { createSession, getSession, deleteSession, startSweeper, TTL_MS };
