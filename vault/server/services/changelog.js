'use strict';

// Admin changelog: one row per commit saying what it did, what code it touched, the goal, the benefit and any concerns.
// Rows come from server/config/changelogEntries.json (written by Claude from the git history) and are inserted on boot by commit hash.
// An existing row is never overwritten, so a later edit in the database is kept. See docs/changelog.md.

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const SEED_FILE = path.join(__dirname, '../config/changelogEntries.json');

/** Insert any entry in the seed file that is not in the table yet. Returns how many were added. */
async function seedChangelog() {
  if (!fs.existsSync(SEED_FILE)) return 0;
  const { entries } = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  let added = 0;
  let corrected = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !e.commit || !e.committedAt || !e.subject) continue;
    const r = await pool.query(
      `INSERT INTO changelog_entries (commit, "fullHash", "committedAt", author, subject, area, goal, "whatChanged", "filesImpacted", benefit, concerns, "filesChanged", insertions, deletions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)
       ON CONFLICT (commit) DO NOTHING`,
      [e.commit, e.fullHash || null, e.committedAt, e.author || null, e.subject, e.area || '', e.goal || '', e.whatChanged || '',
        JSON.stringify(Array.isArray(e.filesImpacted) ? e.filesImpacted : []), e.benefit || '', e.concerns || '',
        e.filesChanged ?? null, e.insertions ?? null, e.deletions ?? null]
    );
    added += r.rowCount || 0;
    if (!r.rowCount && e.replacesText) corrected += await applyCorrection(e);
  }
  if (added) console.log(`[changelog] added ${added} entr${added === 1 ? 'y' : 'ies'}`);
  if (corrected) console.log(`[changelog] corrected ${corrected} entr${corrected === 1 ? 'y' : 'ies'}`);
  return added;
}

// Text fields a correction may change.
const CORRECTABLE = { goal: 'goal', whatChanged: '"whatChanged"', benefit: 'benefit', concerns: 'concerns' };

/**
 * Correct an entry already in the table. `e.replacesText` holds the old wording of each field being corrected; the row is
 * updated only where it still holds exactly that wording, so an edit made in the database is never overwritten.
 */
async function applyCorrection(e) {
  const sets = [];
  const wheres = [];
  const params = [e.commit];
  for (const [field, oldText] of Object.entries(e.replacesText || {})) {
    if (!CORRECTABLE[field] || typeof oldText !== 'string' || typeof e[field] !== 'string') continue;
    params.push(e[field]);
    sets.push(`${CORRECTABLE[field]} = $${params.length}`);
    params.push(oldText);
    wheres.push(`${CORRECTABLE[field]} = $${params.length}`);
  }
  if (!sets.length) return 0;
  const r = await pool.query(`UPDATE changelog_entries SET ${sets.join(', ')} WHERE commit = $1 AND ${wheres.join(' AND ')}`, params);
  return r.rowCount || 0;
}

/** Every entry, newest first. */
async function listChangelog() {
  const { rows } = await pool.query(
    `SELECT id, commit, "fullHash", "committedAt", author, subject, area, goal, "whatChanged", "filesImpacted", benefit, concerns, "filesChanged", insertions, deletions
       FROM changelog_entries ORDER BY "committedAt" DESC, id DESC`
  );
  return rows.map((r) => ({ ...r, filesImpacted: typeof r.filesImpacted === 'string' ? JSON.parse(r.filesImpacted) : r.filesImpacted || [] }));
}

module.exports = { seedChangelog, listChangelog, SEED_FILE };
