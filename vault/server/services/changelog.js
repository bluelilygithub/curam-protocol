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
  }
  if (added) console.log(`[changelog] added ${added} entr${added === 1 ? 'y' : 'ies'}`);
  return added;
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
